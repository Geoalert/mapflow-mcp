import { createServer } from "./mcp-server.js";

const server = createServer();
const transportMode = process.env.MAPFLOW_TRANSPORT ?? "stdio";

try {
	if (transportMode === "http") {
		const { WebStandardStreamableHTTPServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
		);

		const webTransport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});
		await server.connect(webTransport);

		const port = Number(process.env.PORT) || 3000;

		Bun.serve({
			port,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/mcp") {
					const authHeader = req.headers.get("authorization");
					const bearerToken = authHeader?.startsWith("Bearer ")
						? authHeader.slice(7)
						: undefined;

					return webTransport.handleRequest(req, {
						authInfo: bearerToken
							? {
									token: bearerToken,
									clientId: "http-client",
									scopes: [],
								}
							: undefined,
					});
				}
				return new Response("Not Found", { status: 404 });
			},
		});
		console.error(`HTTP server listening on port ${port}`);
	} else {
		const { StdioServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/stdio.js"
		);

		const stdioTransport = new StdioServerTransport();
		await server.connect(stdioTransport);
		console.error("Server started (stdio)");
	}
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error("Failed to start MCP server:", message);
	process.exitCode = 1;
}
