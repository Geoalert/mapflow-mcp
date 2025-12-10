import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import {
	geoJsonGeometrySchema,
	mapflowProcessingSchema,
	mapflowUserStatusSchema,
} from "./schemas.js";

const server = new McpServer({ name: "mapflow-mcp", version: "0.1.0" });

const baseUrl = "https://api.mapflow.ai";

function getMapflowToken() {
	const token = Bun.env?.MAPFLOW_TOKEN ?? process.env.MAPFLOW_TOKEN;
	if (!token) {
		throw new Error(
			"Mapflow API token is required. Please set MAPFLOW_TOKEN environment variable.",
		);
	}
	return token;
}

server.registerTool(
	"start-processing",
	{
		title: "Start Mapflow processing",
		description: "Create a new Mapflow processing task with a GeoJSON AOI.",
		inputSchema: {
			name: z.string().min(1).describe("Processing name to show in Mapflow."),
			wdName: z
				.string()
				.min(1)
				.describe(
					"Workflow display name (e.g., 🏠 Buildings) from mapflow://user/status.",
				),
			geometry: geoJsonGeometrySchema.describe(
				"GeoJSON geometry for the area of interest.",
			),
			params: z
				.record(z.string(), z.unknown())
				.default({})
				.optional()
				.describe("Optional processing params."),
			meta: z
				.record(z.string(), z.unknown())
				.default({})
				.optional()
				.describe("Optional metadata to store with the processing."),
		},
	},
	async ({ name, wdName, geometry, params, meta }) => {
		const token = getMapflowToken();
		const endpoint = new URL("/rest/processings", baseUrl);

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Basic ${token}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name,
				wdName,
				geometry,
				params: params ?? {},
				meta: meta ?? {},
			}),
		});

		const rawBody = await response.text();

		if (!response.ok) {
			throw new Error(
				`Mapflow API request failed: ${response.status} ${response.statusText}${
					rawBody ? ` - ${rawBody}` : ""
				}`,
			);
		}

		const parsed = mapflowProcessingSchema.parse(JSON.parse(rawBody));

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							id: parsed.id,
							status: parsed.status,
							vectorLayer: parsed.vectorLayer,
							rasterLayer: parsed.rasterLayer,
							resultRasterLayer: parsed.resultRasterLayer,
						},
						null,
						2,
					),
				},
			],
			structuredContent: parsed,
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
		const token = getMapflowToken();
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
