// Mapflow Interactive's tools on this server (off unless MAPFLOW_INTERACTIVE_URL is set): SAM3 and Fewshots in a
// session on the user's MyImagery imagery, its prompts and its card in the chat. Every tool is written here
// (tools.ts, texts.ts, next.ts); each call goes to the app's route for it (`/api/agent/v2`) as the same user, and the
// app's answer is said as the model reads it: its JSON with `next` worded, its pictures, the prose that follows, and
// the card's `_meta`. Nothing is read from the app but the calls.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	CallToolResult,
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { recordToolError } from "../logging.js";
import { type ApiCredentials, ApiError } from "../transport.js";
import {
	BRAND,
	CARD_MIME,
	CARD_URI,
	cardMeta,
	cardPage,
	RESULT_META,
} from "./card.js";
import { callApp, type Envelope, Refusal } from "./client.js";
import type { InteractiveConfig } from "./config.js";
import { worded } from "./next.js";
import { PROSE } from "./prose.js";
import {
	find_objects,
	instructions,
	PROMPTS,
	polish_results,
} from "./texts.js";
import { interactiveTools, ROUTES } from "./tools.js";

export { CARD_TOOL_META, CARD_URI, RESULT_META } from "./card.js";
export { type InteractiveConfig, readInteractiveConfig } from "./config.js";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The joint server's own instructions, before Mapflow Interactive's: which of the two ways to take for a request
 * to find objects, and what follows either. Only with Mapflow Interactive's tools: the platform's tools alone have no
 * instructions. */
export const JOINT_INSTRUCTIONS = [
	"This server has Mapflow's tools and Mapflow Interactive's in one. Two ways to find objects on the user's imagery:",
	"- Mapflow's models: list-models lists those the user can run (Mapflow's trained models, such as buildings, roads, forest and tree crowns, and models of their own). When one of them is made for the objects the user asks for, run it as a processing over the area: calculate-cost first, tell the user the cost and wait for their yes, then start-processing; get-processing follows it.",
	"- Mapflow Interactive (SAM3 and Fewshots in a session on a MyImagery mosaic; the prompt find-objects): for kinds of objects no model of theirs covers, or their own definition of one. Its instructions follow.",
	"After either, offer to polish the result (the prompt polish-results): it fixes a processing's result on the user's MyImagery, or a session's round. A config tuned in a session can be published to run as one of the user's models.",
].join("\n");

/** The server's instructions: the joint block, then Mapflow Interactive's; none without its tools. */
export function serverInstructions(
	config?: InteractiveConfig,
): string | undefined {
	return config
		? `${JOINT_INSTRUCTIONS}\n\n${instructions(config.fewshot)}`
		: undefined;
}

const toolError = (code: string, message: string): CallToolResult => ({
	isError: true,
	content: [{ type: "text", text: JSON.stringify({ code, message }) }],
});

/** The app's answer as the model reads it. */
export function render(answer: Envelope): CallToolResult {
	const content: CallToolResult["content"] = [
		{ type: "text", text: JSON.stringify(worded(answer.result)) },
	];
	for (const picture of answer.pictures)
		content.push({
			type: "image",
			data: picture.data,
			mimeType: picture.mimeType,
		});
	const prose = answer.steps ? PROSE[answer.steps] : undefined;
	if (prose) content.push({ type: "text", text: prose });
	const meta: Record<string, unknown> = {};
	if (answer.card) meta[RESULT_META] = answer.card;
	if (answer.pictureUrl)
		meta["mapflow-interactive/image_url"] = answer.pictureUrl;
	return { content, ...(Object.keys(meta).length ? { _meta: meta } : {}) };
}

/** Mapflow Interactive's tools, prompts and card on `server`; a tool calls the app with `credentials`. */
export function addInteractive(
	server: McpServer & { toolNames: Set<string> },
	config: InteractiveConfig,
	credentials: (extra: Extra) => ApiCredentials | undefined,
	uploadStatus: (token: string, extra: Extra) => Promise<CallToolResult>,
) {
	for (const tool of interactiveTools(config.fewshot)) {
		if (server.toolNames.has(tool.name))
			throw new Error(`tool ${tool.name} is a name of this server's`);
		server.toolNames.add(tool.name);
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				// The app refuses an argument a tool doesn't take, saying which it takes: so they reach it.
				inputSchema: z.looseObject(tool.inputSchema),
				annotations: tool.annotations,
				...(tool._meta ? { _meta: tool._meta } : {}),
			},
			async (args, extra) => {
				const given = credentials(extra);
				if (!given)
					return toolError("AUTH_REQUIRED", "Mapflow token is required");
				// image-status of an upload is the upload's own route, which takes nothing else.
				const upload =
					tool.name === "image-status" || tool.name === "upload-refresh"
						? (args as { upload?: unknown }).upload
						: undefined;
				if (typeof upload === "string" && upload.startsWith("mf-"))
					return uploadStatus(upload, extra);
				const [route, sent] =
					upload && tool.name === "image-status"
						? [ROUTES["upload-status"], { upload }]
						: [tool.route, args as Record<string, unknown>];
				try {
					return render(await callApp(config, route, sent, given, extra));
				} catch (error) {
					recordToolError(error);
					if (error instanceof Refusal)
						return {
							isError: true,
							content: [{ type: "text", text: error.message }],
						};
					return error instanceof ApiError
						? toolError(error.code, error.message)
						: toolError(
								"TOOL_ERROR",
								"Tool failed; check the parameters and retry",
							);
				}
			},
		);
	}
	const texts: Record<string, (fewshot: boolean) => string> = {
		"find-objects": find_objects,
		"polish-results": polish_results,
	};
	for (const [name, text] of Object.entries(texts)) {
		const prompt = PROMPTS[name as keyof typeof PROMPTS];
		const task = prompt.arguments?.[0];
		server.registerPrompt(
			name,
			{
				title: prompt.title,
				description: prompt.description,
				argsSchema: {
					task: z
						.string()
						.optional()
						.describe(task?.description ?? ""),
				},
			},
			async ({ task: given }) => ({
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text:
								text(config.fewshot) +
								(given?.trim() ? `\n\nThe user's task: ${given}` : ""),
						},
					},
				],
			}),
		);
	}
	const meta = cardMeta(config);
	server.registerResource(
		"session",
		CARD_URI,
		{
			title: `${BRAND} session`,
			description:
				"The session's map with the run's outlines, live; click to correct",
			mimeType: CARD_MIME,
			_meta: meta,
		},
		async () => ({
			contents: [
				{
					uri: CARD_URI,
					mimeType: CARD_MIME,
					text: await cardPage(config),
					_meta: meta,
				},
			],
		}),
	);
}
