import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
	CallToolResult,
	GetPromptResult,
	JSONRPCMessage,
	ReadResourceResult,
	RequestId,
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import {
	currentLogContext,
	logEvent,
	observe,
	recordToolError,
} from "./logging.js";
import { type ApiCredentials, ApiError } from "./transport.js";

// Mapflow Interactive's tools, listed from the manifest its app publishes and forwarded to its REST routes, so no
// tool of it is written here. Off unless MAPFLOW_INTERACTIVE_URL is set. The app checks each call's arguments, as
// its own MCP does; this module checks the manifest before anything of it is listed.

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The joint server's own instructions, before Mapflow Interactive's (its manifest's): which of the two ways to take
 * for a request to find objects, and what follows either. Only with Mapflow Interactive's tools loaded: the
 * platform's tools alone have no instructions. */
export const JOINT_INSTRUCTIONS = [
	"This server has Mapflow's tools and Mapflow Interactive's in one. Two ways to find objects on the user's imagery:",
	"- Mapflow's models: list-models lists those the user can run (Mapflow's trained models, such as buildings, roads, forest and tree crowns, and models of their own). When one of them is made for the objects the user asks for, run it as a processing over the area: calculate-cost first, tell the user the cost and wait for their yes, then start-processing; get-processing follows it.",
	"- Mapflow Interactive (SAM3 and Fewshots in a session on a MyImagery mosaic; the prompt find-objects): for kinds of objects no model of theirs covers, or their own definition of one. Its instructions follow.",
	"After either, offer to polish the result (the prompt polish-results): it fixes a processing's result on the user's MyImagery, or a session's round. A config tuned in a session can be published to run as one of the user's models.",
].join("\n");

/** The server's instructions: the joint block, then the manifest's, with Mapflow Interactive's tools; none without. */
export function serverInstructions(manifest?: {
	instructions?: string | null;
}): string | undefined {
	if (!manifest) return undefined;
	return manifest.instructions
		? `${JOINT_INSTRUCTIONS}\n\n${manifest.instructions}`
		: JOINT_INSTRUCTIONS;
}

const PREFIX = "/api/agent/v1";
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ARGUMENT = /^[a-z][a-zA-Z0-9]*$/;
const LIMITS = {
	tools: 64,
	name: 64,
	title: 120,
	description: 4_000,
	schemaChars: 20_000,
	instructions: 16_000,
	manifestBytes: 512 * 1024,
	pageBytes: 4 * 1024 * 1024,
};

const annotationsSchema = z
	.object({
		readOnlyHint: z.boolean(),
		destructiveHint: z.boolean(),
		openWorldHint: z.boolean(),
		idempotentHint: z.boolean().optional(),
	})
	.strict();
const toolSchema = z
	.object({
		name: z.string().max(LIMITS.name).regex(NAME),
		title: z.string().min(1).max(LIMITS.title),
		description: z.string().min(1).max(LIMITS.description),
		inputSchema: z
			.object({
				type: z.literal("object"),
				properties: z
					.record(z.string().regex(ARGUMENT), z.unknown())
					.optional(),
			})
			.loose(),
		annotations: annotationsSchema,
		_meta: z.record(z.string(), z.unknown()).optional(),
	})
	// No output schema: a host holding an old one could refuse a correct answer.
	.strict();
const promptSchema = z.object({
	name: z.string().max(LIMITS.name).regex(NAME),
	title: z.string().max(LIMITS.title).optional(),
	description: z.string().max(LIMITS.description).optional(),
	arguments: z
		.array(
			z.object({
				name: z.string().regex(ARGUMENT),
				description: z.string().max(LIMITS.description).optional(),
				required: z.boolean().optional(),
			}),
		)
		.max(8)
		.optional(),
});
const resourceSchema = z.object({
	uri: z.string().startsWith("ui://").max(200),
	name: z.string().min(1).max(LIMITS.name),
	title: z.string().max(LIMITS.title).optional(),
	description: z.string().max(LIMITS.description).optional(),
	mimeType: z.string().max(100).optional(),
	_meta: z.record(z.string(), z.unknown()).optional(),
});
const attachSchema = z.object({
	tool: z.string(),
	_meta: z.record(z.string(), z.unknown()),
	resultMeta: z.record(z.string(), z.unknown()),
});
const manifestSchema = z.object({
	version: z.string().min(1).max(64),
	server: z.object({ name: z.string(), title: z.string().nullish() }).loose(),
	instructions: z.string().max(LIMITS.instructions).nullish(),
	tools: z.array(toolSchema).max(LIMITS.tools),
	prompts: z.array(promptSchema).max(8).default([]),
	resources: z.array(resourceSchema).max(4).default([]),
	attach: z.array(attachSchema).max(8).default([]),
	// Tools leaving with the next release: still listed and answered, and only then may they go.
	deprecated: z.array(z.string()).default([]),
});
export type Manifest = z.infer<typeof manifestSchema>;
const callResultSchema = z
	.object({
		content: z.array(z.object({ type: z.string() }).loose()),
		isError: z.boolean().optional(),
		_meta: z.record(z.string(), z.unknown()).optional(),
	})
	.loose();

export class ManifestError extends Error {}

const canonical = (name: string) => name.replaceAll("_", "-");

/** The manifest, checked before anything of it is listed; the previous one is what it may not drop tools from. */
export function checkManifest(
	raw: unknown,
	reserved: ReadonlySet<string>,
	previous?: Manifest,
): Manifest {
	const parsed = manifestSchema.safeParse(raw);
	if (!parsed.success)
		throw new ManifestError(
			parsed.error.issues
				.slice(0, 5)
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join("; "),
		);
	const manifest = parsed.data;
	// The schemas go out as the app wrote them, to the byte: the parse puts keys in its own order.
	const written = (
		raw as {
			tools: { inputSchema: Manifest["tools"][number]["inputSchema"] }[];
		}
	).tools;
	manifest.tools.forEach((tool, i) => {
		const schema = written[i]?.inputSchema;
		if (schema) tool.inputSchema = schema;
	});
	const theirs = new Set([...reserved].map(canonical));
	const names = new Set<string>();
	for (const tool of manifest.tools) {
		if (names.has(tool.name))
			throw new ManifestError(`tool ${tool.name} is listed twice`);
		if (theirs.has(canonical(tool.name)))
			throw new ManifestError(`tool ${tool.name} is a name of this server's`);
		if (JSON.stringify(tool.inputSchema).length > LIMITS.schemaChars)
			throw new ManifestError(`tool ${tool.name}'s schema is too large`);
		names.add(tool.name);
	}
	const prompts = new Set<string>();
	for (const prompt of manifest.prompts) {
		if (prompts.has(prompt.name))
			throw new ManifestError(`prompt ${prompt.name} is listed twice`);
		prompts.add(prompt.name);
	}
	for (const attach of manifest.attach)
		if (!reserved.has(attach.tool))
			throw new ManifestError(
				`attach names ${attach.tool}, not a tool of this server's`,
			);
	for (const name of manifest.deprecated)
		if (!names.has(name))
			throw new ManifestError(`deprecated names ${name}, which isn't listed`);
	for (const tool of previous?.tools ?? [])
		if (!names.has(tool.name) && !previous?.deprecated.includes(tool.name))
			throw new ManifestError(
				`tool ${tool.name} is dropped without a release as deprecated`,
			);
	return manifest;
}

export type InteractiveConfig = {
	baseUrl: string;
	/** MAPFLOW_INTERACTIVE_KEY: the key the app's manifest and cards' page answer, sent as X-Interactive-Key. */
	key: string;
	refreshMs: number;
	timeoutMs: number;
};

const seconds = (value: string | undefined, fallback: number, max: number) => {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

/** MAPFLOW_INTERACTIVE_URL (the app's address, HTTPS) with MAPFLOW_INTERACTIVE_KEY (the key its manifest answers),
 * and how often the manifest is read again and how long a call may take. */
export function readInteractiveConfig(
	env: Record<string, string | undefined>,
): InteractiveConfig | undefined {
	const raw = env.MAPFLOW_INTERACTIVE_URL?.trim();
	if (!raw) return undefined;
	const url = new URL(raw);
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
		throw new Error("MAPFLOW_INTERACTIVE_URL must be an https URL");
	if (url.search || url.hash || url.username || url.password)
		throw new Error("MAPFLOW_INTERACTIVE_URL is an address only");
	const key = env.MAPFLOW_INTERACTIVE_KEY?.trim();
	if (!key)
		throw new Error(
			"MAPFLOW_INTERACTIVE_KEY must be set with MAPFLOW_INTERACTIVE_URL",
		);
	return {
		baseUrl: url.href.replace(/\/+$/, ""),
		key,
		refreshMs:
			seconds(env.MAPFLOW_INTERACTIVE_REFRESH_SECONDS, 300, 3600) * 1000,
		timeoutMs: seconds(env.MAPFLOW_INTERACTIVE_TIMEOUT_SECONDS, 60, 600) * 1000,
	};
}

/** The last good manifest, read again in the background: the server's own tools never wait for it. */
export class InteractiveCatalog {
	#manifest?: Manifest;
	#etag?: string;
	#timer?: ReturnType<typeof setInterval>;
	readonly #pages = new Map<
		string,
		{ etag?: string; result: ReadResourceResult }
	>();

	constructor(
		readonly config: InteractiveConfig,
		readonly reserved: ReadonlySet<string>,
	) {}

	get manifest() {
		return this.#manifest;
	}

	url(path: string) {
		const url = new URL(`${this.config.baseUrl}${path}`);
		if (url.origin !== new URL(this.config.baseUrl).origin)
			throw new ApiError("Cross-origin request is not allowed");
		return url;
	}

	async refresh(): Promise<void> {
		const start = performance.now();
		try {
			const response = await fetch(this.url(`${PREFIX}/manifest`), {
				headers: {
					Accept: "application/json",
					"X-Interactive-Key": this.config.key,
					...(this.#etag ? { "If-None-Match": this.#etag } : {}),
				},
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
			});
			if (response.status === 304) return;
			if (!response.ok) {
				await response.body?.cancel();
				throw new ManifestError(`HTTP_${response.status}`);
			}
			const text = await response.text();
			if (text.length > LIMITS.manifestBytes)
				throw new ManifestError("the manifest is too large");
			const next = checkManifest(
				JSON.parse(text),
				this.reserved,
				this.#manifest,
			);
			this.#manifest = next;
			this.#etag = response.headers.get("etag") ?? undefined;
			logEvent("interactive.manifest", {
				outcome: "success",
				durationMs: performance.now() - start,
				manifestVersion: next.version,
			});
		} catch (error) {
			logEvent("interactive.manifest", {
				outcome: "error",
				durationMs: performance.now() - start,
				errorCode:
					error instanceof ManifestError
						? "MANIFEST_REFUSED"
						: "MANIFEST_UNAVAILABLE",
				manifestVersion: this.#manifest?.version,
			});
		}
	}

	start() {
		void this.refresh();
		this.#timer ??= setInterval(
			() => void this.refresh(),
			this.config.refreshMs,
		);
		this.#timer.unref?.();
	}

	stop() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = undefined;
	}

	/** A card's page, kept by its ETag. */
	async page(uri: string): Promise<ReadResourceResult> {
		const kept = this.#pages.get(uri);
		const response = await fetch(
			this.url(`${PREFIX}/resources?uri=${encodeURIComponent(uri)}`),
			{
				headers: {
					Accept: "application/json",
					"X-Interactive-Key": this.config.key,
					...(kept?.etag ? { "If-None-Match": kept.etag } : {}),
				},
				redirect: "error",
				signal: AbortSignal.timeout(this.config.timeoutMs),
			},
		);
		if (response.status === 304 && kept) return kept.result;
		if (!response.ok) {
			await response.body?.cancel();
			throw new ApiError(
				`Mapflow Interactive answered ${response.status}`,
				`HTTP_${response.status}`,
			);
		}
		const text = await response.text();
		if (text.length > LIMITS.pageBytes)
			throw new ApiError("The card's page is too large", "INVALID_RESPONSE");
		const result = JSON.parse(text) as ReadResourceResult;
		this.#pages.set(uri, {
			etag: response.headers.get("etag") ?? undefined,
			result,
		});
		return result;
	}
}

export type InteractiveOptions = {
	catalog: InteractiveCatalog;
	credentials: (extra: Extra) => ApiCredentials | undefined;
};

const toolError = (code: string, message: string): CallToolResult => ({
	isError: true,
	content: [{ type: "text", text: JSON.stringify({ code, message }) }],
});

async function post(
	catalog: InteractiveCatalog,
	path: string,
	body: unknown,
	credentials: ApiCredentials,
	extra: Extra,
): Promise<unknown> {
	const authorization =
		typeof credentials === "string"
			? `Basic ${credentials}`
			: `Bearer ${credentials.token}`;
	const userAgent = extra.requestInfo?.headers["user-agent"];
	return observe(
		"api.completed",
		{ service: "interactive" },
		async (setStatus) => {
			let response: Response;
			try {
				response = await fetch(catalog.url(path), {
					method: "POST",
					body: JSON.stringify(body ?? {}),
					redirect: "error",
					signal: AbortSignal.timeout(catalog.config.timeoutMs),
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						Authorization: authorization,
						"X-Request-Id": currentLogContext()?.requestId ?? "",
						...(typeof userAgent === "string"
							? { "X-Interactive-Client": userAgent.slice(0, 200) }
							: {}),
					},
				});
			} catch (error) {
				throw error instanceof Error && error.name === "TimeoutError"
					? new ApiError(
							`Mapflow Interactive didn't answer within ${Math.round(catalog.config.timeoutMs / 1000)} s; a run goes on there: call wait for it`,
							"TIMEOUT",
						)
					: new ApiError("Mapflow Interactive network error", "NETWORK_ERROR");
			}
			setStatus(response.status);
			if (!response.ok) {
				await response.body?.cancel();
				if (response.status === 401)
					throw new ApiError(
						"Mapflow Interactive refused the sign-in",
						"AUTH_REJECTED",
					);
				if (response.status === 404)
					throw new ApiError(
						"This is no longer offered; refresh the tools list",
						"NOT_FOUND",
					);
				if (response.status === 429 || response.status === 503) {
					const after = response.headers.get("retry-after");
					throw new ApiError(
						`Mapflow Interactive is busy${after ? `; try again in ${after} s` : "; try again shortly"}`,
						"BUSY",
					);
				}
				throw new ApiError(
					`Mapflow Interactive answered ${response.status}`,
					`HTTP_${response.status}`,
				);
			}
			try {
				return await response.json();
			} catch {
				throw new ApiError(
					"Mapflow Interactive returned invalid JSON",
					"INVALID_RESPONSE",
				);
			}
		},
	);
}

/** Our tools, prompts and cards' page on `server`, from the manifest held now. Each tool is registered with a schema
 * that lets every argument through (the app checks them); `interactiveTransport` lists the manifest's schemas. */
export function addInteractive(
	server: McpServer & { toolNames: Set<string> },
	manifest: Manifest,
	options: InteractiveOptions,
) {
	const passing = z.looseObject({});
	for (const tool of manifest.tools) {
		if (server.toolNames.has(tool.name)) continue; // never over one of the server's own
		server.toolNames.add(tool.name);
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: passing,
				annotations: tool.annotations,
				_meta: tool._meta,
			},
			async (args, extra) => {
				const credentials = options.credentials(extra);
				if (!credentials)
					return toolError("AUTH_REQUIRED", "Mapflow token is required");
				try {
					const raw = await post(
						options.catalog,
						`${PREFIX}/tools/${encodeURIComponent(tool.name)}`,
						args,
						credentials,
						extra,
					);
					const parsed = callResultSchema.safeParse(raw);
					if (!parsed.success)
						throw new ApiError(
							"Mapflow Interactive returned an unexpected answer",
							"INVALID_RESPONSE",
						);
					return parsed.data as CallToolResult;
				} catch (error) {
					recordToolError(error);
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
	for (const prompt of manifest.prompts) {
		const shape: Record<string, z.ZodOptional<z.ZodString> | z.ZodString> = {};
		for (const argument of prompt.arguments ?? []) {
			const value = z.string().describe(argument.description ?? "");
			shape[argument.name] = argument.required ? value : value.optional();
		}
		server.registerPrompt(
			prompt.name,
			{
				title: prompt.title,
				description: prompt.description,
				argsSchema: shape,
			},
			async (args, extra) => {
				const credentials = options.credentials(extra);
				if (!credentials)
					throw new ApiError("Mapflow token is required", "AUTH_REQUIRED");
				return (await post(
					options.catalog,
					`${PREFIX}/prompts/${encodeURIComponent(prompt.name)}`,
					args,
					credentials,
					extra,
				)) as GetPromptResult;
			},
		);
	}
	for (const resource of manifest.resources)
		server.registerResource(
			resource.name,
			resource.uri,
			{
				title: resource.title,
				description: resource.description,
				mimeType: resource.mimeType,
				_meta: resource._meta,
			},
			() => options.catalog.page(resource.uri),
		);
}

type Pending =
	| { method: "tools/list" }
	| { method: "tools/call"; tool: string };

/** The transport with the manifest's input schemas in each `tools/list` answer (the SDK lists a schema it holds as zod,
 * and ours are JSON Schemas as the app wrote them), and a card attached to a tool of the server's own: its page in
 * the tool's `_meta`, and what to show in each of its results' `_meta`. */
export function interactiveTransport(
	inner: Transport,
	manifest: Manifest,
): Transport {
	const ours = new Map(manifest.tools.map((tool) => [tool.name, tool]));
	const attached = new Map(
		manifest.attach.map((attach) => [attach.tool, attach]),
	);
	const pending = new Map<RequestId, Pending>();
	const patch = (message: JSONRPCMessage): JSONRPCMessage => {
		if (!("result" in message)) {
			if ("id" in message && message.id !== undefined)
				pending.delete(message.id);
			return message;
		}
		const asked = pending.get(message.id);
		if (!asked) return message;
		pending.delete(message.id);
		const result = message.result as Record<string, unknown>;
		if (asked.method === "tools/list" && Array.isArray(result.tools)) {
			const tools = (result.tools as Record<string, unknown>[]).map((tool) => {
				const name = String(tool.name);
				const mine = ours.get(name);
				if (mine) return { ...tool, inputSchema: mine.inputSchema };
				const card = attached.get(name);
				if (card)
					return {
						...tool,
						_meta: { ...((tool._meta as object) ?? {}), ...card._meta },
					};
				return tool;
			});
			return { ...message, result: { ...result, tools } };
		}
		if (asked.method === "tools/call") {
			const card = attached.get(asked.tool);
			if (card && result.isError !== true)
				return {
					...message,
					result: {
						...result,
						_meta: { ...((result._meta as object) ?? {}), ...card.resultMeta },
					},
				};
		}
		return message;
	};
	const wrapper: Transport = {
		get sessionId() {
			return inner.sessionId;
		},
		setProtocolVersion(version) {
			inner.setProtocolVersion?.(version);
		},
		async start() {
			inner.onmessage = (message, extra) => {
				if ("method" in message && "id" in message) {
					if (message.method === "tools/list")
						pending.set(message.id, { method: "tools/list" });
					else if (message.method === "tools/call") {
						const name = message.params?.name;
						if (typeof name === "string" && attached.has(name))
							pending.set(message.id, { method: "tools/call", tool: name });
					}
				}
				wrapper.onmessage?.(message, extra);
			};
			inner.onerror = (error) => wrapper.onerror?.(error);
			inner.onclose = () => {
				pending.clear();
				wrapper.onclose?.();
			};
			await inner.start();
		},
		async send(message, options) {
			await inner.send(patch(message), options);
		},
		async close() {
			pending.clear();
			await inner.close();
		},
	};
	return wrapper;
}
