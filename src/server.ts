import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import {
	geoJsonGeometrySchema,
	mapflowProcessingSchema,
	mapflowUserLimitsSchema,
	mapflowUserModelBlocksSchema,
	mapflowUserModelsSchema,
	mapflowUserStatusSchema,
	mapflowUserTeamsSchema,
} from "./schemas.js";

const server = new McpServer({ name: "mapflow-mcp", version: "0.1.0" });

const baseUrl = "https://api.mapflow.ai";
const userStatusCacheTtlMs = 300_000;

type UserStatus = z.infer<typeof mapflowUserStatusSchema>;

let userStatusCache: { data: UserStatus; expiresAt: number } | null = null;

function getMapflowToken() {
	const token = Bun.env?.MAPFLOW_TOKEN ?? process.env.MAPFLOW_TOKEN;
	if (!token) {
		throw new Error(
			"Mapflow API token is required. Please set MAPFLOW_TOKEN environment variable.",
		);
	}
	return token;
}

async function fetchUserStatus(): Promise<UserStatus> {
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

	return mapflowUserStatusSchema.parse(await response.json());
}

async function getCachedUserStatus(): Promise<UserStatus> {
	const now = Date.now();
	if (userStatusCache && userStatusCache.expiresAt > now) {
		return userStatusCache.data;
	}

	const fresh = await fetchUserStatus();
	userStatusCache = {
		data: fresh,
		expiresAt: now + userStatusCacheTtlMs,
	};
	return fresh;
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
					"Workflow display name (e.g., 🏠 Buildings) from mapflow://user/models.",
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
	"user-models",
	"mapflow://user/models",
	{
		title: "Mapflow user models",
		description: "Available Mapflow models",
		mimeType: "application/json",
	},
	async (uri) => {
		const status = await getCachedUserStatus();
		const models = mapflowUserModelsSchema.parse(status.models ?? []);

		return {
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(models, null, 2),
				},
			],
		};
	},
);

server.registerResource(
	"user-model-blocks",
	"mapflow://user/models/{modelId}/blocks",
	{
		title: "Mapflow model blocks",
		description: "Postprocessing blocks for a specific Mapflow model",
		mimeType: "application/json",
	},
	async (uri) => {
		const status = await getCachedUserStatus();
		const segments = uri.pathname.split("/").filter(Boolean);
		const modelId = segments[segments.length - 2];
		if (!modelId || segments[segments.length - 1] !== "blocks") {
			throw new Error(
				"Invalid URI. Use mapflow://user/models/{modelId}/blocks",
			);
		}

		const model = (status.models ?? []).find((m) => m.id === modelId);
		if (!model) {
			throw new Error(`Model not found for id ${modelId}`);
		}

		const blocks = mapflowUserModelBlocksSchema.parse(model.blocks ?? []);

		return {
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(blocks, null, 2),
				},
			],
		};
	},
);

server.registerResource(
	"user-teams",
	"mapflow://user/teams",
	{
		title: "Mapflow user teams",
		description: "Mapflow teams",
		mimeType: "application/json",
	},
	async (uri) => {
		const status = await getCachedUserStatus();
		const teams = mapflowUserTeamsSchema.parse(status.teams ?? []);

		return {
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(teams, null, 2),
				},
			],
		};
	},
);

server.registerResource(
	"user-limits",
	"mapflow://user/limits",
	{
		title: "Mapflow user limits",
		description: "Current Mapflow usage limits",
		mimeType: "application/json",
	},
	async (uri) => {
		const status = await fetchUserStatus();
		const limits = mapflowUserLimitsSchema.parse({
			processedArea: status.processedArea,
			remainingArea: status.remainingArea,
			areaLimit: status.areaLimit,
			memoryLimit: status.memoryLimit,
		});

		return {
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(limits, null, 2),
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
