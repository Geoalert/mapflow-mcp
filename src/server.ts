import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import area from "@turf/area";
import simplify from "@turf/simplify";
import * as z from "zod";
import { createMapflowClient, type MapflowClient } from "./mapflow-client.js";
import { createNominatimClient } from "./nominatim-client.js";
import {
	geoJsonGeometrySchema,
	mapflowDataProviderParamsSchema,
	mapflowProcessingBlockSchema,
} from "./schemas.js";

function createServer(): McpServer {
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
						"Workflow display name (e.g., 🏠 Buildings) from available models.",
					),
				geometry: geoJsonGeometrySchema.describe(
					"GeoJSON geometry for the area of interest.",
				),
				dataProvider: mapflowDataProviderParamsSchema.describe(
					"Data provider configuration. Use name from available imagery sources.",
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
						"Optional postprocessing blocks configuration. Use blocks from selected model.",
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
						"Workflow display name (e.g., 🏠 Buildings) from available models.",
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
						"Data provider configuration. Use name from available imagery sources.",
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

	registerModelsAsTool(server, mapflowClient);
	registerLimitsAsTool(server, mapflowClient);
	registerImagerySourcesAsTool(server, mapflowClient);

	return server;
}

function registerModelsAsTool(server: McpServer, client: MapflowClient): void {
	server.registerTool(
		"list-models",
		{
			title: "List Mapflow models",
			description:
				"List available Mapflow AI models for processing satellite imagery.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => {
			const models = await client.getModels();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(models, null, 2),
					},
				],
				structuredContent: { models },
			};
		},
	);
}

function registerLimitsAsTool(server: McpServer, client: MapflowClient): void {
	server.registerTool(
		"get-limits",
		{
			title: "Get Mapflow limits",
			description: "Get current Mapflow usage limits and remaining credits.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => {
			const limits = await client.getLimits();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(limits, null, 2),
					},
				],
				structuredContent: limits,
			};
		},
	);
}

function registerImagerySourcesAsTool(
	server: McpServer,
	client: MapflowClient,
): void {
	server.registerTool(
		"list-imagery-sources",
		{
			title: "List Mapflow imagery sources",
			description:
				"List available imagery sources (data providers) for Mapflow processing.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => {
			const sources = await client.getImagerySources();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(sources, null, 2),
					},
				],
				structuredContent: { imagerySources: sources },
			};
		},
	);
}

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
					return webTransport.handleRequest(req);
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
