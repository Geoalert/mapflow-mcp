import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
	EmbeddedResource,
	ServerNotification,
	ServerRequest,
	TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import * as api from "./api-schemas.js";
import { bufferGeometry, geometryDetails } from "./geometry.js";
import { GeometryCache, geometryOwner } from "./geometry-cache.js";
import {
	createGeometryOutput,
	splitGeometryOutput,
} from "./geometry-output.js";
import * as presentation from "./geometry-presentation.js";
import * as geometryTools from "./geometry-tools.js";
import * as input from "./inputs.js";
import { recordToolError } from "./logging.js";
import { loggingTransport } from "./logging-transport.js";
import { createMapflowClient, type MapflowClient } from "./mapflow-client.js";
import {
	createNominatimClient,
	type NominatimClient,
} from "./nominatim-client.js";
import {
	resultOutputSchema,
	resultRequestSchema,
} from "./processing-result.js";
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
		geometryCache?: GeometryCache;
		geometryOwner?: string;
	} = {},
) {
	const server = new LoggedMcpServer({ name: "mapflow-mcp", version: "0.2.0" });
	const clients = new Map<string, MapflowClient>();
	const geometryCache = options.geometryCache ?? new GeometryCache();
	const owner = (extra: Extra) => {
		if (options.geometryOwner) return options.geometryOwner;
		const token =
			extra.authInfo?.token ??
			(options.allowEnvToken === false ? undefined : Bun.env.MAPFLOW_TOKEN);
		if (!token)
			throw new ApiError(
				"Mapflow token is required for cached geometry",
				"AUTH_REQUIRED",
			);
		return geometryOwner(`api:${token}`);
	};
	const resolve = <T extends { geometry?: unknown; geometryId?: string }>(
		args: T,
		extra: Extra,
	) => geometryTools.resolveGeometry(args, geometryCache, () => owner(extra));
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
		attachment?: (value: unknown) => EmbeddedResource | TextContent,
	) {
		server.toolNames.add(name);
		server.registerTool<z.ZodObject, z.ZodObject<S>>(
			name,
			{
				title: name
					.replaceAll("-", " ")
					.replace(/^./, (letter) => letter.toUpperCase()),
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
					const raw = await handler(schema.parse(args), extra);
					const data = output.parse(raw);
					return {
						content: [
							{ type: "text" as const, text: JSON.stringify(data) },
							...(attachment ? [attachment(raw)] : []),
						],
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
		"List account and Lab models together, including their processing blocks and kind. Use the model name for calculate-cost and start-processing. Lab models are attached to the target project automatically when starting a processing.",
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
		"Get compact project metadata (ID, name, dates, area and processing counts) by UUID or projectId='default'. Model definitions and prices are available from list-models.",
		input.getProjectSchema,
		api.projectSchema.omit({ workflowDefs: true }),
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
		"Get mosaic metadata and a compact footprint summary with geometryId. geometryMode=simplified requests an overview; full requires explicit maxOutputBytes and may be withheld with a warning.",
		geometryTools.mosaicToolSchema,
		presentation.mosaicOutputSchema,
		async (a, e) => {
			const { options } = splitGeometryOutput(a);
			const presenter = createGeometryOutput(geometryCache, owner(e), options);
			const { geometry, ...metadata } = await client(e).getMosaic(a.mosaicId);
			const contour = presenter.present(geometry);
			const result = { ...metadata, geometrySummary: contour?.summary ?? null };
			presenter.attach(result, "geometry", contour);
			return presenter.finish(result);
		},
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
		"Get processing status and progress. Use get-processing-result for GeoJSON; internal map layers are not download links.",
		input.processingIdSchema,
		api.processingOutputSchema,
		(a, e) => client(e).getProcessing(a.processingId),
	);
	register(
		"get-processing-result",
		"Retrieve a completed processing's complete GeoJSON file. Default delivery=resource returns an embedded MCP resource: save its complete contents using fileName and provide the resulting .geojson file to the user. Do not paste the GeoJSON into the conversation. Use delivery=text only when the client cannot consume embedded resources or inline text is specifically required. WARNING: text delivery consumes model context and may be truncated by the client; verify completeness before saving. maxResultBytes limits UTF-8 file size (default 65536, maximum 5242880); explicitly increase it if needed for the complete file. Embedded resources may also consume context depending on the client. Oversized files fail without partial content. Requires processing access; the resource URI is not a public download URL, and the client must save the file.",
		resultRequestSchema,
		resultOutputSchema.omit({ text: true }),
		(a, e) => client(e).getProcessingResult(a),
		"read",
		(raw) => {
			const result = resultOutputSchema.parse(raw);
			if (result.delivery === "text")
				return { type: "text", text: result.text };
			return {
				type: "resource",
				resource: {
					uri: result.resourceUri,
					mimeType: result.mimeType,
					text: result.text,
				},
			};
		},
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
		"Search imagery by geometry or cached geometryId and filters without changing any selection. Contours and preview geometries are compact summaries by default; geometryMode=simplified requests overviews, full requires explicit maxOutputBytes and may be withheld with a warning. Results are paginated: use sortBy/sortOrder for the user's selection criterion and follow hasNext with offset + count before claiming the best image across all matches. Unknown and inactive provider names are rejected. Resolution is meters per pixel; angles are degrees.",
		geometryTools.searchCatalogToolSchema,
		presentation.catalogOutputSchema,
		async (a, e) => {
			const { input: args, options } = splitGeometryOutput(a);
			const presenter = createGeometryOutput(geometryCache, owner(e), options);
			const result = await client(e).searchImageryCatalog(
				input.searchCatalogSchema.parse(resolve(args, e)),
			);
			return presenter.finish({
				...result,
				items: result.items.map((image) =>
					presentation.presentImage(image, presenter),
				),
			});
		},
	);
	register(
		"get-image-metadata",
		"Get catalog image metadata and compact footprint/preview summaries by opaque image ID. geometryMode=simplified requests overview contours; full requires explicit maxOutputBytes and may be withheld with a warning. Use previews (each with a contour summary and url) for composite imagery such as Roscosmos; previewUrl alone can be incomplete. Pass dataProvider and zoom from search-imagery-catalog to disambiguate variants. ArcGIS World Imagery (dataProvider=arcgis_world_imagery) does not support lookup by ID; use the metadata returned by search-imagery-catalog instead. Use dataProvider=maxar only for the legacy Maxar catalog.",
		geometryTools.imageMetadataToolSchema,
		presentation.imageOutputSchema,
		async (a, e) => {
			const { input: args, options } = splitGeometryOutput(a);
			const presenter = createGeometryOutput(geometryCache, owner(e), options);
			const image = await client(e).getImageMetadata(args);
			if (!image) throw new ApiError("Image not found", "NOT_FOUND");
			return presenter.finish(presentation.presentImage(image, presenter));
		},
	);
	register(
		"get-geoboundary",
		"Search OpenStreetMap for a place. Ambiguous point matches return compact place choices and suggested queries; region boundaries are not silently substituted for cities. Points and lines require an explicit positive bufferMeters. Returns a cached geometryId and summary; geometryMode=simplified requests an overview; full (or legacy includeGeometry=true) requires explicit maxOutputBytes and may be withheld with a warning. IDs expire after inactivity or server restart. Polygon geometry is not silently simplified.",
		geometryTools.geoboundaryToolSchema,
		geometryTools.cachedGeometrySchema.extend({
			displayName: z.string(),
			osmId: z.number().optional(),
			osmType: z.string().optional(),
			appliedBufferMeters: z.number(),
		}),
		async (a, e) => {
			const { options } = splitGeometryOutput(a);
			const presenter = createGeometryOutput(geometryCache, owner(e), options);
			const found = await nominatim.searchBoundary(
				a.query,
				Boolean(a.bufferMeters && a.bufferMeters > 0),
			);
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
			const contour = presenter.present(details.geometry);
			if (!contour) throw new ApiError("Invalid boundary", "INVALID_RESPONSE");
			const result = {
				...contour.summary,
				displayName: found.display_name,
				osmId: found.osm_id,
				osmType: found.osm_type,
				appliedBufferMeters: a.bufferMeters ?? 0,
			};
			presenter.attach(result, "geometry", contour);
			Object.assign(result, contour.summary);
			return presenter.finish(result);
		},
	);
	register(
		"buffer-aoi",
		"Buffer geometry or geometryId by distanceMeters. Returns a new cached geometryId and summary without changing the original. geometryMode=simplified requests an overview; full (or legacy includeGeometry=true) requires explicit maxOutputBytes and may be withheld with a warning. Recalculate cost for the new ID.",
		geometryTools.bufferAoiToolSchema,
		geometryTools.cachedGeometrySchema.extend({
			appliedBufferMeters: z.number(),
		}),
		(a, e) => {
			const { input: args, options } = splitGeometryOutput(a);
			const presenter = createGeometryOutput(geometryCache, owner(e), options);
			const resolved = input.bufferAoiSchema.parse(resolve(args, e));
			const details = bufferGeometry(
				resolved.geometry,
				resolved.distanceMeters,
			);
			const contour = presenter.present(details.geometry);
			if (!contour) throw new ApiError("Invalid buffer", "INVALID_RESPONSE");
			const result = {
				...contour.summary,
				appliedBufferMeters: details.appliedBufferMeters,
			};
			presenter.attach(result, "geometry", contour);
			Object.assign(result, contour.summary);
			return presenter.finish(result);
		},
	);
	register(
		"calculate-cost",
		"Accept geometry or cached geometryId (or areaSqKm for a preliminary estimate). Estimate credits, separating imagery and processing costs. Estimates without geometry or source are preliminary. Recalculate after changing any launch parameter.",
		geometryTools.calculateCostToolSchema,
		api.costOutputSchema,
		(a, e) =>
			client(e).calculateCost(
				input.calculateCostRequestSchema.parse(resolve(a, e)),
			),
	);
	register(
		"start-processing",
		"Start a paid processing for geometry or cached geometryId using the specified model and imagery. Charges account credits and creates a new processing on each call. A Lab model is first attached to the target project (the default project when projectId is omitted) and added to its model selection; account preferences are unchanged. calculate-cost estimates the price without attaching models. Partial mosaic failures are returned as warnings. An expired geometryId requires a fresh geometry and estimate. A timeout leaves the outcome unknown; list-processings can locate the processing before any retry.",
		geometryTools.createProcessingToolSchema,
		api.processingOutputSchema.extend({ warnings: z.array(z.string()) }),
		(a, e) =>
			client(e).createProcessing(
				input.createProcessingRequestSchema.parse(resolve(a, e)),
			),
		"charge",
	);
	return server;
}
