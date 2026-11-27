import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import {
	CARD_MIME,
	cardMeta,
	cardPage,
	RESULT_META,
} from "../interactive/card.js";
import { type ApiCredentials, ApiError } from "../transport.js";
import type { UploadService } from "./http.js";
import { UploadError } from "./store.js";

export const UPLOAD_CARD = "ui://mapflow/upload.html";
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
const schema = z.strictObject({
	file: z
		.object({
			download_url: z.url(),
			file_id: z.string(),
			file_name: z.string().optional(),
			mime_type: z.string().optional(),
		})
		.optional()
		.describe("GeoTIFF attachment supplied by the chat host."),
	fileName: z.string().max(255).optional(),
	fileSize: z.int().positive().optional(),
	sha1: z
		.string()
		.regex(/^[a-fA-F0-9]{40}$/)
		.optional()
		.describe("Reuse a matching image in your My Imagery."),
	name: z
		.string()
		.trim()
		.min(1)
		.max(120)
		.optional()
		.describe("New mosaic name; defaults to the file name."),
	mosaicId: z
		.uuid()
		.optional()
		.describe("Add to this existing mosaic. Omit to create a new mosaic."),
});
const reply = (data: Record<string, unknown>) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data) }],
	structuredContent: data,
});
async function guarded(call: () => Promise<ReturnType<typeof reply>>) {
	try {
		return await call();
	} catch (error) {
		return {
			isError: true,
			content: [
				{
					type: "text" as const,
					text:
						error instanceof UploadError || error instanceof ApiError
							? error.message
							: "Upload failed. Check My Imagery.",
				},
			],
		};
	}
}
export function addUploads(
	server: McpServer & { toolNames: Set<string> },
	service: UploadService,
	actor: (extra: Extra) => { owner: string; credentials: ApiCredentials },
	interactive: boolean,
) {
	const template = {
		ui: { resourceUri: UPLOAD_CARD },
		"ui/resourceUri": UPLOAD_CARD,
		"openai/outputTemplate": UPLOAD_CARD,
		"openai/fileParams": ["file"],
	};
	const config = () => ({
		baseUrl: service.publicOrigin(),
		imageOrigins: [],
		fewshot: false,
		timeoutMs: 60000,
	});
	// Resource metadata is also included on read so stdio opens its listener only when needed.
	server.registerResource(
		"upload-card",
		UPLOAD_CARD,
		{ title: "Upload a GeoTIFF to My Imagery", mimeType: CARD_MIME },
		async () => {
			const settings = config();
			return {
				contents: [
					{
						uri: UPLOAD_CARD,
						mimeType: CARD_MIME,
						text: await cardPage(settings, "Mapflow"),
						_meta: cardMeta(settings),
					},
				],
			};
		},
	);
	const outputSchema = z.looseObject({ upload: z.string(), state: z.string() });
	const read = {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	};
	server.toolNames.add("upload-image");
	server.registerTool(
		"upload-image",
		{
			title: "Upload a GeoTIFF to My Imagery",
			description:
				"Upload a chat attachment or choose a GeoTIFF on the card or upload_url. With mosaicId, add it to that mosaic; otherwise create a mosaic. Follow image-status(upload) until ready.",
			inputSchema: schema,
			outputSchema,
			annotations: { ...read, readOnlyHint: false, idempotentHint: false },
			_meta: template,
		},
		async (args, extra) => {
			const result = await guarded(async () => {
				const origin = service.publicOrigin();
				const upload = await service.store.create(actor(extra), args);
				return reply(upload.result(origin));
			});
			return { ...result, _meta: { [RESULT_META]: { tool: "upload-image" } } };
		},
	);
	const statusInput = z.strictObject({ upload: z.string().max(40) });
	const status = (token: string, extra: Extra) =>
		guarded(async () => {
			const upload = service.store.get(token);
			upload.renew(actor(extra));
			await upload.poll();
			return reply(upload.result(service.publicOrigin()));
		});
	if (!interactive) {
		server.toolNames.add("upload-refresh");
		server.registerTool(
			"upload-refresh",
			{
				title: "Refresh upload authorization",
				description:
					"Renew the calling user's upload authorization before sending the file.",
				inputSchema: statusInput,
				outputSchema,
				annotations: read,
				_meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
			},
			(a, e) => status(a.upload, e),
		);
		server.toolNames.add("image-status");
		server.registerTool(
			"image-status",
			{
				title: "My Imagery upload status",
				description: "Check the upload and processing state of your GeoTIFF.",
				inputSchema: statusInput,
				outputSchema,
				annotations: read,
			},
			(a, e) => status(a.upload, e),
		);
	}
	return status;
}
