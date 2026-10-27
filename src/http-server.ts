import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMapflowClient } from "./mapflow-client.js";
import { createServer } from "./mcp-server.js";
import { createNominatimClient } from "./nominatim-client.js";
import { createOAuth, type OAuthConfig, OAuthError } from "./oauth.js";

export function createHttpHandler(config?: OAuthConfig) {
	const oauth = config ? createOAuth(config) : undefined;
	const nominatim = createNominatimClient();
	return async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
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
		let client: ReturnType<typeof createMapflowClient> | undefined;
		if (isOAuth) {
			try {
				client = createMapflowClient(
					await oauth.authenticate(req.headers.get("authorization")),
				);
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
						nominatim,
					}
				: { nominatim },
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
			return await transport.handleRequest(req, {
				authInfo:
					!isOAuth && token
						? { token, clientId: "legacy-token", scopes: [] }
						: undefined,
			});
		} finally {
			await server.close();
		}
	};
}
