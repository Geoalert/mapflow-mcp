import * as z from "zod";

export const mapflowModelBlockSchema = z
	.object({
		name: z.string().optional(),
		displayName: z.string().optional(),
		optional: z.boolean().optional(),
		price: z.number().optional(),
	})
	.catchall(z.unknown());

export const mapflowModelSchema = z
	.object({
		id: z.uuid().optional(),
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		created: z.string().optional(),
		updated: z.string().optional(),
		pricePerSqKm: z.number().optional(),
		blocks: z.array(mapflowModelBlockSchema).optional(),
	})
	.catchall(z.unknown());

export const mapflowTeamSchema = z
	.object({
		teamId: z.uuid().optional(),
		name: z.string().optional(),
		role: z.string().optional(),
		activeUntil: z.string().nullable().optional(),
		creditsLimit: z.number().nullable().optional(),
	})
	.catchall(z.unknown());

export const mapflowDataProviderPriceSchema = z
	.object({
		zoom: z.number().optional(),
		priceSqKm: z.number().optional(),
	})
	.catchall(z.unknown());

export const mapflowDataProviderSchema = z
	.object({
		id: z.uuid().optional(),
		name: z.string().optional(),
		displayName: z.string().optional(),
		previewUrl: z.string().optional(),
		previewUrlMaxZoom: z.number().optional(),
		price: z.array(mapflowDataProviderPriceSchema).optional(),
	})
	.catchall(z.unknown());

export const mapflowUserStatusSchema = z
	.object({
		email: z.email().optional(),
		processedArea: z.number().optional(),
		remainingArea: z.number().optional(),
		remainingCredits: z.number().optional(),
		areaLimit: z.number().optional(),
		maxAoisPerProcessing: z.number().optional(),
		memoryLimit: z.number().optional(),
		billingType: z.union([z.number(), z.string()]).optional(),
		models: z.array(mapflowModelSchema).optional(),
		teams: z.array(mapflowTeamSchema).optional(),
		dataProviders: z.array(mapflowDataProviderSchema).optional(),
		reviewWorkflowEnabled: z.boolean().optional(),
	})
	.catchall(z.unknown());

export const mapflowUserProfileSchema = z
	.object({
		email: z.email().optional(),
	})
	.catchall(z.unknown());

export const mapflowUserModelsSchema = z.array(mapflowModelSchema);

export const mapflowUserTeamsSchema = z.array(mapflowTeamSchema);

export const mapflowUserLimitsSchema = z
	.object({
		processedArea: z.number().optional(),
		remainingArea: z.number().optional(),
		remainingCredits: z.number().optional(),
		areaLimit: z.number().optional(),
		memoryLimit: z.number().optional(),
	})
	.catchall(z.unknown());

export const mapflowUserModelBlocksSchema = z.array(mapflowModelBlockSchema);

export const mapflowProcessingBlockSchema = z
	.object({
		name: z.string(),
		enabled: z.boolean(),
	})
	.catchall(z.unknown());

// V2 API schemas - input schema for requests
export const mapflowDataProviderParamsSchema = z
	.object({
		name: z.string(),
		zoom: z.number(),
	})
	.catchall(z.unknown());

// Response schema for dataProvider (API returns providerName, not name)
export const mapflowDataProviderResponseSchema = z
	.object({
		providerName: z.string().optional(),
		name: z.string().optional(),
		zoom: z.number().optional(),
	})
	.catchall(z.unknown());

export const mapflowSourceParamsSchema = z
	.object({
		dataProvider: mapflowDataProviderResponseSchema.optional(),
	})
	.catchall(z.unknown());

export const mapflowInferenceParamsSchema = z
	.record(z.string(), z.unknown())
	.nullable()
	.optional();

export const mapflowProcessingParamsSchema = z
	.object({
		sourceParams: mapflowSourceParamsSchema.nullable().optional(),
		inferenceParams: mapflowInferenceParamsSchema,
	})
	.catchall(z.unknown());

export const mapflowReviewStatusSchema = z
	.object({
		status: z.string().optional(),
		feedback: z.string().optional(),
	})
	.catchall(z.unknown());

export const mapflowRatingSchema = z
	.object({
		rating: z.number().optional(),
		feedback: z.string().optional(),
	})
	.catchall(z.unknown());

export const geoJsonGeometrySchema = z
	.object({
		type: z.string(),
		coordinates: z.array(z.unknown()),
	})
	.catchall(z.unknown());

export const mapflowLayerSchema = z
	.object({
		id: z.uuid().optional(),
		name: z.string().optional(),
		tileJsonUrl: z.string().url().optional(),
		tileUrl: z.string().url().optional(),
	})
	.catchall(z.unknown());

export const mapflowProcessingSchema = z
	.object({
		id: z.uuid().optional(),
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		projectId: z.uuid().optional(),
		vectorLayer: mapflowLayerSchema.nullable().optional(),
		rasterLayer: mapflowLayerSchema.nullable().optional(),
		resultRasterLayer: mapflowLayerSchema.nullable().optional(),
		workflowDef: z.record(z.string(), z.unknown()).optional(),
		aoiCount: z.number().optional(),
		aoiArea: z.number().optional(),
		area: z.number().optional(),
		cost: z.number().optional(),
		status: z.string().optional(),
		reviewStatus: mapflowReviewStatusSchema.nullable().optional(),
		rating: mapflowRatingSchema.nullable().optional(),
		percentCompleted: z.number().optional(),
		params: mapflowProcessingParamsSchema.optional(),
		blocks: z.array(mapflowProcessingBlockSchema).optional(),
		meta: z.record(z.string(), z.unknown()).optional(),
		messages: z.array(z.unknown()).optional(),
		created: z.string().optional(),
		updated: z.string().optional(),
	})
	.catchall(z.unknown());

// Nominatim API schemas
export const nominatimResultSchema = z
	.object({
		place_id: z.number(),
		osm_type: z.string().optional(),
		osm_id: z.number().optional(),
		lat: z.string(),
		lon: z.string(),
		display_name: z.string(),
		boundingbox: z.array(z.string()).optional(),
		geojson: geoJsonGeometrySchema.optional(),
	})
	.catchall(z.unknown());

export const nominatimSearchResponseSchema = z.array(nominatimResultSchema);

// Request schemas for v2 API
export const createProcessingRequestSchema = z.object({
	name: z.string().min(1),
	wdName: z.string().min(1),
	geometry: geoJsonGeometrySchema,
	dataProvider: mapflowDataProviderParamsSchema,
	projectId: z.uuid().optional(),
	inferenceParams: z.record(z.string(), z.unknown()).optional(),
	blocks: z.array(mapflowProcessingBlockSchema).optional(),
	meta: z.record(z.string(), z.unknown()).optional(),
});

export type CreateProcessingRequest = z.infer<
	typeof createProcessingRequestSchema
>;

export const calculateCostRequestSchema = z.object({
	wdName: z.string().min(1),
	geometry: geoJsonGeometrySchema.optional(),
	areaSqKm: z.number().optional(),
	dataProvider: mapflowDataProviderParamsSchema.optional(),
	blocks: z.array(mapflowProcessingBlockSchema).optional(),
});

export type CalculateCostRequest = z.infer<typeof calculateCostRequestSchema>;
