import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import area from "@turf/area";
import simplify from "@turf/simplify";
import * as z from "zod";
import { createMapflowClient } from "./mapflow-client.js";
import { createNominatimClient } from "./nominatim-client.js";
import {
	geoJsonGeometrySchema,
	mapflowDataProviderParamsSchema,
	mapflowProcessingBlockSchema,
} from "./schemas.js";

const server = new McpServer({ name: "mapflow-mcp", version: "0.1.0" });
const mapflowClient = createMapflowClient();
const nominatimClient = createNominatimClient();

server.registerTool(
	"start-processing",
	{
		title: "Start Mapflow processing",
		description: "Create a new Mapflow processing task with a GeoJSON AOI.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true,
		},
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
			dataProvider: mapflowDataProviderParamsSchema.describe(
				"Data provider configuration. Use name from mapflow://imagery-sources.",
			),
			inferenceParams: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Optional model inference parameters."),
			meta: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Optional metadata to store with the processing."),
			blocks: z
				.array(mapflowProcessingBlockSchema)
				.optional()
				.describe(
					"Optional postprocessing blocks configuration. Use blocks from mapflow://models/{modelId}/blocks.",
				),
		},
	},
	async ({
		name,
		wdName,
		geometry,
		dataProvider,
		inferenceParams,
		meta,
		blocks,
	}) => {
		const parsed = await mapflowClient.createProcessing({
			name,
			wdName,
			geometry,
			dataProvider,
			inferenceParams,
			meta,
			blocks,
		});

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							id: parsed.id,
							status: parsed.status,
							cost: parsed.cost,
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
	"get-processing",
	{
		title: "Get Mapflow processing",
		description: "Get status and results of a Mapflow processing task by ID.",
		annotations: {
			readOnlyHint: true,
		},
		inputSchema: {
			processingId: z.uuid().describe("Processing ID to check."),
		},
	},
	async ({ processingId }) => {
		const parsed = await mapflowClient.getProcessing(processingId);

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							id: parsed.id,
							name: parsed.name,
							status: parsed.status,
							percentCompleted: parsed.percentCompleted,
							cost: parsed.cost,
							vectorLayer: parsed.vectorLayer,
							rasterLayer: parsed.rasterLayer,
							resultRasterLayer: parsed.resultRasterLayer,
							messages: parsed.messages,
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
	"calculate-cost",
	{
		title: "Calculate processing cost",
		description: "Estimate cost in credits before starting a processing.",
		annotations: {
			readOnlyHint: true,
		},
		inputSchema: {
			wdName: z
				.string()
				.min(1)
				.describe(
					"Workflow display name (e.g., 🏠 Buildings) from mapflow://models.",
				),
			geometry: geoJsonGeometrySchema
				.optional()
				.describe("GeoJSON geometry for the area of interest."),
			areaSqKm: z
				.number()
				.optional()
				.describe("Area in square kilometers (alternative to geometry)."),
			dataProvider: mapflowDataProviderParamsSchema
				.optional()
				.describe(
					"Data provider configuration. Use name from mapflow://imagery-sources.",
				),
			blocks: z
				.array(mapflowProcessingBlockSchema)
				.optional()
				.describe("Optional postprocessing blocks configuration."),
		},
	},
	async ({ wdName, geometry, areaSqKm, dataProvider, blocks }) => {
		const cost = await mapflowClient.calculateCost({
			wdName,
			geometry,
			areaSqKm,
			dataProvider,
			blocks,
		});

		return {
			content: [
				{
					type: "text",
					text: `Estimated cost: ${cost} credits`,
				},
			],
			structuredContent: { cost },
		};
	},
);

server.registerTool(
	"get-geoboundary",
	{
		title: "Get Geoboundary",
		description:
			"Search for administrative boundaries by place name using OpenStreetMap Nominatim. Returns a GeoJSON polygon.",
		annotations: {
			readOnlyHint: true,
			openWorldHint: true,
		},
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
		const models = await mapflowClient.getModels();

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
	new ResourceTemplate("mapflow://models/{modelName}/blocks", {
		list: async () => {
			try {
				const models = await mapflowClient.getModels();
				return {
					resources: models
						.filter((model) => {
							return typeof model.name === "string" && model.name.length > 0;
						})
						.map((model) => {
							const modelName = model.name ?? "";
							return {
								uri: `mapflow://models/${encodeURIComponent(modelName)}/blocks`,
								name: modelName,
							};
						}),
				};
			} catch (error) {
				console.error("Error fetching models:", error);
				return { resources: [] };
			}
		},
	}),
	{
		title: "Mapflow model blocks",
		description: "Postprocessing blocks for a specific Mapflow model",
		mimeType: "application/json",
	},
	async (uri, { modelName }) => {
		const rawName = Array.isArray(modelName) ? modelName[0] : modelName;
		const name = rawName ? decodeURIComponent(rawName) : undefined;
		if (!name) {
			throw new Error("Model name is required");
		}

		const blocks = await mapflowClient.getModelBlocks(name);
		if (!blocks) {
			throw new Error(`Model not found for name: ${name}`);
		}

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
		const limits = await mapflowClient.getLimits();

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

server.registerResource(
	"imagery-sources",
	"mapflow://imagery-sources",
	{
		title: "Mapflow imagery sources",
		description: "Available imagery sources for processing",
		mimeType: "application/json",
	},
	async (uri) => {
		const sources = await mapflowClient.getImagerySources();

		return {
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(sources, null, 2),
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
