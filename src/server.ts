import { logEvent } from "./logging.js";
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
		logEvent("server.started", { outcome: "success", transport: "http" });
	} else {
		const { StdioServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/stdio.js"
		);
		await createServer().connect(new StdioServerTransport());
		logEvent("server.started", { outcome: "success", transport: "stdio" });
	}
} catch {
	logEvent("server.failed", { outcome: "error", errorCode: "STARTUP_ERROR" });
	process.exitCode = 1;
}
