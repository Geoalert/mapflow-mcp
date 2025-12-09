import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const server = new McpServer({ name: "mapflow-mcp", version: "0.1.0" });

server.registerTool(
	"hello",
	{
		title: "Hello",
		description:
			"Return a friendly greeting to confirm the MCP server is responding.",
		inputSchema: {
			name: z.string().optional().describe("Optional name to include."),
		},
	},
	async ({ name }) => {
		const target =
			typeof name === "string" && name.trim().length > 0
				? name.trim()
				: "world";

		return {
			content: [
				{
					type: "text",
					text: `Hello, ${target}!`,
				},
			],
		};
	},
);

const transport = new StdioServerTransport();

try {
	await server.connect(transport);
	console.error("Server started"); // stderr is safe
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error("Failed to start MCP server:", message);
	process.exitCode = 1;
}
