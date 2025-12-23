import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import area from "@turf/area";
import simplify from "@turf/simplify";
import * as z from "zod";
import { createMapflowClient } from "./mapflow-client.js";
import { createNominatimClient } from "./nominatim-client.js";
import {
	geoJsonGeometrySchema,
	mapflowProcessingSchema,
	mapflowUserLimitsSchema,
	mapflowUserModelBlocksSchema,
	mapflowUserModelsSchema,
} from "./schemas.js";

const server = new McpServer({ name: "mapflow-mcp", version: "0.1.0" });
const mapflowClient = createMapflowClient();
const nominatimClient = createNominatimClient();

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
					"Workflow display name (e.g., 🏠 Buildings) from mapflow://models.",
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
		const parsed = await mapflowClient.requestJson(
			"/rest/processings",
			mapflowProcessingSchema,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name,
					wdName,
					geometry,
					params: params ?? {},
					meta: meta ?? {},
				}),
			},
		);

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

server.registerTool(
	"get-geoboundary",
	{
		title: "Get Geoboundary",
		description:
			"Search for administrative boundaries by place name using OpenStreetMap Nominatim. Returns a GeoJSON polygon.",
		inputSchema: {
			query: z
				.string()
				.min(1)
				.describe(
					"Place name to search for (e.g., 'Moscow, Russia' or 'New York City')",
				),
		},
	},
	async ({ query }) => {
		const result = await nominatimClient.searchBoundary(query);

		if (!result) {
			return {
				content: [
					{
						type: "text",
						text: `No boundary found for: ${query}`,
					},
				],
			};
		}

		if (!result.geojson) {
			return {
				content: [
					{
						type: "text",
						text: `No geometry found for: ${query}`,
					},
				],
			};
		}

		const geometry = result.geojson as GeoJSON.Geometry;

		// Calculate area in square meters using Turf.js
		const areaM2 = area(geometry);
		const areaKm2 = areaM2 / 1_000_000;

		// Simplify geometry to reduce size (tolerance in degrees, ~0.001 ≈ 100m)
		const simplifiedGeometry = simplify(geometry, {
			tolerance: 0.001,
			highQuality: true,
		});

		const output = {
			displayName: result.display_name,
			osmId: result.osm_id,
			osmType: result.osm_type,
			boundingbox: result.boundingbox,
			geometry: simplifiedGeometry,
			areaM2,
			areaKm2,
		};

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(output, null, 2),
				},
			],
			structuredContent: output,
		};
	},
);

server.registerResource(
	"models",
	"mapflow://models",
	{
		title: "Mapflow user models",
		description: "Available Mapflow models",
		mimeType: "application/json",
	},
	async (uri) => {
		const status = await mapflowClient.getCachedUserStatus();
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
	"model-blocks",
	"mapflow://models/{modelId}/blocks",
	{
		title: "Mapflow model blocks",
		description: "Postprocessing blocks for a specific Mapflow model",
		mimeType: "application/json",
	},
	async (uri) => {
		const status = await mapflowClient.getCachedUserStatus();
		const segments = uri.pathname.split("/").filter(Boolean);
		const modelId = segments[segments.length - 2];
		if (!modelId || segments[segments.length - 1] !== "blocks") {
			throw new Error("Invalid URI. Use mapflow://models/{modelId}/blocks");
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
	"limits",
	"mapflow://limits",
	{
		title: "Mapflow user limits",
		description: "Current Mapflow usage limits",
		mimeType: "application/json",
	},
	async (uri) => {
		const status = await mapflowClient.fetchUserStatus();
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
