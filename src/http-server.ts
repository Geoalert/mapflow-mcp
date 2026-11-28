import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { GeometryCache } from "./geometry-cache.js";
import type { InteractiveConfig } from "./interactive/index.js";
import {
	currentLogContext,
	elapsedMs,
	logEvent,
	observe,
	safeErrorCode,
	withRequestContext,
} from "./logging.js";
import { createMapflowClient } from "./mapflow-client.js";
import { createServer } from "./mcp-server.js";
import { createNominatimClient } from "./nominatim-client.js";
import { createOAuth, type OAuthConfig, OAuthError } from "./oauth.js";

import { uploadService } from "./upload/http.js";

// Only the binary upload route needs more than Bun’s normal HTTP body limit.
const MAX_RPC_BYTES = 128 * 1024 * 1024;
function limitRpcBody(req: Request) {
	if (!req.body) return req;
	const length = req.headers.get("content-length");
	if (length !== null)
		return Number(length) > MAX_RPC_BYTES
			? new Response("Request body too large", { status: 413 })
			: req;
	let received = 0;
	const body = req.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				received += chunk.byteLength;
				if (received > MAX_RPC_BYTES)
					controller.error(new Error("Request body too large"));
				else controller.enqueue(chunk);
			},
		}),
	);
	return new Request(req, { body });
}

export function createHttpHandler(
	config?: OAuthConfig,
	interactive?: InteractiveConfig,
) {
	const uploadOrigin = new URL(
		Bun.env.MAPFLOW_MCP_PUBLIC_URL ??
			config?.resource ??
			`http://127.0.0.1:${Bun.env.PORT ?? 3000}`,
	).origin;
	const uploads = uploadService(() => uploadOrigin);
	const geometryCache = new GeometryCache();
	const oauth = config ? createOAuth(config) : undefined;
	const nominatim = createNominatimClient();
	const handle = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		if (url.pathname.startsWith("/agent/upload/")) return uploads.handle(req);
		const origin = req.headers.get("origin");
		if (
			origin &&
			origin !== (config ? new URL(config.resource).origin : url.origin)
		)
			return new Response("Forbidden origin", { status: 403 });
		if (oauth && url.pathname === oauth.authorizationMetadataPath) {
			if (req.method !== "GET") return new Response(null, { status: 405 });
			return Response.json(oauth.authorizationMetadata, {
				headers: { "Cache-Control": "no-store" },
			});
		}
		if (
			oauth &&
			[
				"/.well-known/oauth-protected-resource",
				"/.well-known/oauth-protected-resource/mcp/oauth",
			].includes(url.pathname)
		) {
			if (req.method !== "GET") return new Response(null, { status: 405 });
			return Response.json(oauth.metadata);
		}
		const isOAuth = url.pathname === "/mcp/oauth" && oauth;
		if (url.pathname !== "/mcp" && !isOAuth)
			return new Response("Not Found", { status: 404 });
		let cacheOwner: string | undefined;
		let client: ReturnType<typeof createMapflowClient> | undefined;
		let exchanged: { scheme: "Bearer"; token: string } | undefined;
		if (isOAuth) {
			try {
				const credentials = await observe("oauth.completed", {}, async () =>
					oauth.authenticate(req.headers.get("authorization")),
				);
				client = createMapflowClient(credentials);
				cacheOwner = credentials.geometryOwner;
				exchanged = { scheme: "Bearer", token: credentials.token };
			} catch (error) {
				if (error instanceof OAuthError) return oauth.errorResponse(error);
				throw error;
			}
		}
		const authenticatedClient = client;
		const server = createServer(
			authenticatedClient
				? {
						getClient: () => authenticatedClient,
						allowEnvToken: false,
						geometryCache,
						geometryOwner: cacheOwner,
						nominatim,
						interactive,
						credentials: exchanged,
						uploads,
					}
				: { nominatim, geometryCache, interactive, uploads },
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		try {
			const token = /^Bearer ([^\s]+)$/i.exec(
				req.headers.get("authorization") ?? "",
			)?.[1];
			const rpc = limitRpcBody(req);
			if (rpc instanceof Response) return rpc;
			return await transport.handleRequest(rpc, {
				authInfo:
					!isOAuth && token
						? { token, clientId: "legacy-token", scopes: [] }
						: undefined,
			});
		} finally {
			await server.close();
		}
	};
	return (req: Request): Promise<Response> =>
		withRequestContext(async () => {
			const start = performance.now();
			const path = new URL(req.url).pathname;
			const route =
				path === "/mcp"
					? "mcp"
					: path === "/mcp/oauth"
						? "oauth"
						: [
									path === oauth?.authorizationMetadataPath,
									path === "/.well-known/oauth-protected-resource",
									path === "/.well-known/oauth-protected-resource/mcp/oauth",
								].some(Boolean)
							? "metadata"
							: "other";
			try {
				const response = await handle(req);
				response.headers.set(
					"X-Request-Id",
					currentLogContext()?.requestId ?? "",
				);
				logEvent("http.completed", {
					route,
					status: response.status,
					outcome: response.status >= 400 ? "error" : "success",
					durationMs: elapsedMs(start),
				});
				return response;
			} catch (error) {
				logEvent("http.completed", {
					route,
					status: 500,
					outcome: "error",
					durationMs: elapsedMs(start),
					errorCode: safeErrorCode(error),
				});
				return new Response("Internal Server Error", {
					status: 500,
					headers: { "X-Request-Id": currentLogContext()?.requestId ?? "" },
				});
			}
		});
}
