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

export const mapflowUserStatusSchema = z
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
		reviewStatus: z.string().nullable().optional(),
		rating: z.number().nullable().optional(),
		percentCompleted: z.number().optional(),
		params: z.record(z.string(), z.unknown()).optional(),
		blocks: z.array(z.unknown()).optional(),
		meta: z.record(z.string(), z.unknown()).optional(),
		messages: z.array(z.unknown()).optional(),
		created: z.string().optional(),
		updated: z.string().optional(),
	})
	.catchall(z.unknown());
