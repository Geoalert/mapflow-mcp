import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const server = new McpServer({ name: "mapflow-mcp", version: "0.1.0" });

const baseUrl = "https://api.mapflow.ai";

const mapflowModelBlockSchema = z
	.object({
		name: z.string().optional(),
		displayName: z.string().optional(),
		optional: z.boolean().optional(),
		price: z.number().optional(),
	})
	.catchall(z.unknown());

const mapflowModelSchema = z
	.object({
		id: z.string().uuid().optional(),
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		created: z.string().optional(),
		updated: z.string().optional(),
		pricePerSqKm: z.number().optional(),
		blocks: z.array(mapflowModelBlockSchema).optional(),
	})
	.catchall(z.unknown());

const mapflowTeamSchema = z
	.object({
		teamId: z.string().uuid().optional(),
		name: z.string().optional(),
		role: z.string().optional(),
		activeUntil: z.string().nullable().optional(),
		creditsLimit: z.number().nullable().optional(),
	})
	.catchall(z.unknown());

const mapflowUserStatusSchema = z
	.object({
		email: z.string().email().optional(),
		processedArea: z.number().optional(),
		remainingArea: z.number().optional(),
		areaLimit: z.number().optional(),
		memoryLimit: z.number().optional(),
		models: z.array(mapflowModelSchema).optional(),
		teams: z.array(mapflowTeamSchema).optional(),
	})
	.catchall(z.unknown());

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

server.registerResource(
	"user-status",
	"mapflow://user/status",
	{
		title: "Mapflow user status",
		description: "Fetch user status from Mapflow API",
		mimeType: "application/json",
	},
	async (uri) => {
		const token = Bun.env?.MAPFLOW_TOKEN ?? process.env.MAPFLOW_TOKEN;

		if (!token) {
			throw new Error(
				"Mapflow API token is required. Please set MAPFLOW_TOKEN environment variable.",
			);
		}

		const endpoint = new URL("/rest/user/status", baseUrl);

		const response = await fetch(endpoint, {
			headers: {
				Authorization: `Basic ${token}`,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Mapflow API request failed: ${response.status} ${response.statusText}${
					body ? ` - ${body}` : ""
				}`,
			);
		}

		const data = mapflowUserStatusSchema.parse(await response.json());

		return {
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(data, null, 2),
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
