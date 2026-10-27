import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import * as api from "./api-schemas.js";
import { bufferGeometry, geometryDetails } from "./geometry.js";
import * as input from "./inputs.js";
import { recordToolError } from "./logging.js";
import { loggingTransport } from "./logging-transport.js";
import { createMapflowClient, type MapflowClient } from "./mapflow-client.js";
import {
	createNominatimClient,
	type NominatimClient,
} from "./nominatim-client.js";
import {
	mapflowDataProviderSchema,
	mapflowModelSchema,
	mapflowUserLimitsSchema,
} from "./schemas.js";
import { ApiError } from "./transport.js";

class LoggedMcpServer extends McpServer {
	readonly toolNames = new Set<string>();
	override connect(transport: Transport) {
		return super.connect(loggingTransport(transport, this.toolNames));
	}
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
export function createServer(
	options: {
		getClient?: (extra: Extra) => MapflowClient;
		nominatim?: NominatimClient;
		allowEnvToken?: boolean;
	} = {},
) {
	const server = new LoggedMcpServer({ name: "mapflow-mcp", version: "0.2.0" });
	const clients = new Map<string, MapflowClient>();
	const nominatim = options.nominatim ?? createNominatimClient();
	const client = (extra: Extra) => {
		if (options.getClient) return options.getClient(extra);
		const token =
			extra.authInfo?.token ??
			(options.allowEnvToken === false ? undefined : Bun.env.MAPFLOW_TOKEN);
		if (!token)
			throw new ApiError("Mapflow token is required", "AUTH_REQUIRED");
		let value = clients.get(token);
		if (!value) {
			value = createMapflowClient(token);
			if (clients.size >= 100) clients.clear();
			clients.set(token, value);
		}
		return value;
	};
	function register<S extends z.ZodRawShape>(
		name: string,
		description: string,
		schema: z.ZodObject<S>,
		output: z.ZodObject,
		handler: (args: z.output<z.ZodObject<S>>, extra: Extra) => unknown,
		behavior: "read" | "create" | "charge" = "read",
	) {
		server.toolNames.add(name);
		server.registerTool<z.ZodObject, z.ZodObject<S>>(
			name,
			{
				description,
				inputSchema: schema,
				outputSchema: output,
				annotations: {
					readOnlyHint: behavior === "read",
					destructiveHint: behavior === "charge",
					idempotentHint: behavior === "read",
					openWorldHint: name !== "buffer-aoi",
				},
			},
			async (args, extra) => {
				try {
					const data = output.parse(await handler(schema.parse(args), extra));
					return {
						content: [{ type: "text" as const, text: JSON.stringify(data) }],
						structuredContent: data,
					};
				} catch (error) {
					recordToolError(error);
					const message =
						error instanceof ApiError
							? error.message
							: error instanceof z.ZodError
								? error.issues
										.map((i) => `${i.path.join(".")}: ${i.message}`)
										.join("; ")
								: "Tool failed; check the parameters and retry read-only operations.";
					return {
						isError: true,
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									code: error instanceof ApiError ? error.code : "TOOL_ERROR",
									message,
								}),
							},
						],
					};
				}
			},
		);
	}
	const empty = z.strictObject({});
	register(
		"list-models",
		"List available models and their processing blocks.",
		empty,
		z.object({ models: z.array(mapflowModelSchema) }),
		async (_, e) => ({ models: await client(e).getModels() }),
	);
	register(
		"list-imagery-sources",
		"List available imagery providers, zoom levels and prices.",
		empty,
		z.object({ imagerySources: z.array(mapflowDataProviderSchema) }),
		async (_, e) => ({ imagerySources: await client(e).getImagerySources() }),
	);
	register(
		"get-limits",
		"Get fresh account limits and remaining credits.",
		empty,
		mapflowUserLimitsSchema,
		(_, e) => client(e).getLimits(),
	);
	register(
		"list-projects",
		"Find accessible projects by name or member email, with pagination.",
		input.listProjectsSchema,
		api.pageOutputSchema(api.projectSchema.omit({ workflowDefs: true })),
		(a, e) => client(e).listProjects(a),
	);
	register(
		"create-project",
		"Create a project with a name and optional description. Returns its ID for start-processing.projectId. Creates a new project on every call; on an unknown outcome check list-projects before retrying.",
		input.createProjectSchema,
		api.projectSchema,
		(a, e) => client(e).createProject(a),
		"create",
	);
	register(
		"get-project",
		"Get a project by UUID, or resolve the user's default project using projectId='default'.",
		input.getProjectSchema,
		api.projectSchema,
		(a, e) => client(e).getProject(a.projectId),
	);
	register(
		"list-mosaics",
		"Find uploaded My Imagery mosaics. Returns summaries without full footprints.",
		input.listMosaicsSchema,
		api.pageOutputSchema(api.mosaicSummarySchema),
		(a, e) => client(e).listMosaics(a),
	);
	register(
		"get-mosaic",
		"Get mosaic metadata and its footprint converted to GeoJSON; invalid footprints produce a warning.",
		input.getMosaicSchema,
		api.mosaicDetailsSchema,
		(a, e) => client(e).getMosaic(a.mosaicId),
	);
	register(
		"get-mosaic-status",
		"Check mosaic data readiness, loading, failures and tile readiness. Request per-image detail only when needed.",
		input.getMosaicStatusSchema,
		api.mosaicStatusOutputSchema,
		(a, e) => client(e).getMosaicStatus(a.mosaicId, a.includeImages),
	);
	register(
		"list-processings",
		"Find processings within a project by description, status or date; newest first by default.",
		input.listProcessingsSchema,
		api.pageOutputSchema(api.processingSummarySchema),
		(a, e) => client(e).listProcessings(a),
	);
	register(
		"get-processing",
		"Get processing status, progress and layer metadata. Does not download results.",
		input.processingIdSchema,
		api.processingSchema,
		(a, e) => client(e).getProcessing(a.processingId),
	);
	register(
		"get-processing-statistics",
		"Get current result counts, areas and lengths by class. Only READY means final numbers. Group areas can overlap; do not sum them as union area.",
		input.processingIdSchema,
		api.statisticsOutputSchema,
		(a, e) => client(e).getProcessingStatistics(a.processingId),
	);
	register(
		"search-imagery-catalog",
		"Search imagery by explicit AOI and filters without changing any selection. Unknown provider names are rejected. Resolution is meters per pixel; angles are degrees.",
		input.searchCatalogSchema,
		api
			.pageOutputSchema(api.catalogImageSchema)
			.extend({ providerErrors: z.unknown() }),
		(a, e) => client(e).searchImageryCatalog(a),
	);
	register(
		"get-image-metadata",
		"Get catalog image metadata by opaque image ID. Pass dataProvider and zoom from search-imagery-catalog to disambiguate variants. Use dataProvider=maxar only for the legacy Maxar catalog.",
		input.imageMetadataSchema,
		api.catalogImageSchema,
		(a, e) => client(e).getImageMetadata(a),
	);
	register(
		"get-geoboundary",
		"Search OpenStreetMap for a place. Points and lines require an explicit positive bufferMeters. Polygon geometry is not silently simplified.",
		input.geoboundarySchema,
		api.geometryDetailsSchema.extend({
			displayName: z.string(),
			osmId: z.number().optional(),
			osmType: z.string().optional(),
			appliedBufferMeters: z.number(),
		}),
		async (a) => {
			const found = await nominatim.searchBoundary(a.query);
			if (!found?.geojson)
				throw new ApiError("No geometry found for this place", "NOT_FOUND");
			const geometry = found.geojson;
			if (
				geometry.type !== "Polygon" &&
				geometry.type !== "MultiPolygon" &&
				!(a.bufferMeters && a.bufferMeters > 0)
			)
				throw new ApiError(
					"A point or line requires an explicit positive bufferMeters",
					"BUFFER_REQUIRED",
				);
			const details =
				a.bufferMeters && a.bufferMeters > 0
					? bufferGeometry(geometry, a.bufferMeters)
					: geometryDetails(geometry);
			return {
				...details,
				displayName: found.display_name,
				osmId: found.osm_id,
				osmType: found.osm_type,
				appliedBufferMeters: a.bufferMeters ?? 0,
			};
		},
	);
	register(
		"buffer-aoi",
		"Buffer a GeoJSON geometry by distanceMeters, returning a new polygon without changing stored state.",
		input.bufferAoiSchema,
		api.geometryDetailsSchema.extend({ appliedBufferMeters: z.number() }),
		(a) => bufferGeometry(a.geometry, a.distanceMeters),
	);
	register(
		"calculate-cost",
		"Estimate credits, separating imagery and processing costs. Estimates without geometry or source are preliminary. Recalculate after changing any launch parameter.",
		input.calculateCostRequestSchema,
		api.costOutputSchema,
		(a, e) => client(e).calculateCost(a),
	);
	register(
		"start-processing",
		"Start a paid processing ONLY after the user confirms the cost for these exact parameters. For partial mosaic failures explain the warning before calling. On timeout check list-processings; never automatically retry.",
		input.createProcessingRequestSchema,
		api.processingSchema.extend({ warnings: z.array(z.string()) }),
		(a, e) => client(e).createProcessing(a),
		"charge",
	);
	return server;
}
