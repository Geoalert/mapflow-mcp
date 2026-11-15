import { InteractiveCatalog, readInteractiveConfig } from "./interactive.js";
import { logEvent } from "./logging.js";
import { createServer } from "./mcp-server.js";
import { createWebLinks } from "./web-links.js";

const transportMode = process.env.MAPFLOW_TRANSPORT ?? "stdio";
try {
	createWebLinks();
	// Mapflow Interactive's tools, from its app's manifest; off without MAPFLOW_INTERACTIVE_URL.
	const interactiveConfig = readInteractiveConfig(process.env);
	const interactive = interactiveConfig
		? new InteractiveCatalog(
				interactiveConfig,
				new Set(createServer({ allowEnvToken: false }).toolNames),
			)
		: undefined;
	if (transportMode === "http") {
		const { createHttpHandler } = await import("./http-server.js");
		const { readOAuthConfig } = await import("./oauth.js");
		const config = readOAuthConfig(process.env);
		if (config && !process.env.MAPFLOW_BASE_URL)
			throw new Error("MAPFLOW_BASE_URL is required with OAuth");
		interactive?.start();
		const port = Number(process.env.PORT) || 3000;
		Bun.serve({ port, fetch: createHttpHandler(config, interactive) });
		logEvent("server.started", { outcome: "success", transport: "http" });
	} else {
		const { StdioServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/stdio.js"
		);
		// A stdio server is one connection: its list is the manifest as it is when it starts.
		await interactive?.refresh();
		await createServer({ interactive }).connect(new StdioServerTransport());
		logEvent("server.started", { outcome: "success", transport: "stdio" });
	}
} catch {
	logEvent("server.failed", { outcome: "error", errorCode: "STARTUP_ERROR" });
	process.exitCode = 1;
}
