import { createServer } from "./mcp-server.js";

const transportMode = process.env.MAPFLOW_TRANSPORT ?? "stdio";
try {
	if (transportMode === "http") {
		const { createHttpHandler } = await import("./http-server.js");
		const { readOAuthConfig } = await import("./oauth.js");
		const config = readOAuthConfig(process.env);
		if (config && !process.env.MAPFLOW_BASE_URL)
			throw new Error("MAPFLOW_BASE_URL is required with OAuth");
		const port = Number(process.env.PORT) || 3000;
		Bun.serve({ port, fetch: createHttpHandler(config) });
		console.error(`HTTP server listening on port ${port}`);
	} else {
		const { StdioServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/stdio.js"
		);
		await createServer().connect(new StdioServerTransport());
		console.error("Server started (stdio)");
	}
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error("Failed to start MCP server:", message);
	process.exitCode = 1;
}
