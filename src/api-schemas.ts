import * as z from "zod";
import { aoiSchema } from "./geometry.js";
import { mapflowProcessingSchema } from "./schemas.js";

const count = z.number().int().nonnegative();
const nullableNumber = z.number().nullable().optional();
export const projectSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable().optional(),
	isDefault: z.boolean().optional(),
	created: z.string().optional(),
	updated: z.string().optional(),
	area: z.number().optional(),
	processingCounts: z.record(z.string(), count).nullish(),
	workflowDefs: z.array(z.record(z.string(), z.unknown())).optional(),
	starred: z.boolean().optional(),
});
export const processingSchema = mapflowProcessingSchema.extend({
	id: z.uuid(),
	status: z.string(),
});
export const processingSummarySchema = z.object({
	id: z.uuid(),
	name: z.string().optional(),
	description: z.string().nullish(),
	projectId: z.uuid().optional(),
	status: z.string(),
	percentCompleted: z.number().optional(),
	cost: z.number().optional(),
	area: z.number().optional(),
	created: z.string().optional(),
	updated: z.string().optional(),
	model: z.string().nullable(),
	imagery: z.record(z.string(), z.unknown()).nullable(),
});
export const statusSummarySchema = z.object({
	total: count,
	ready: count,
	pending: count,
	in_progress: count,
	failed: count,
	loading: count.default(0),
});
export const mosaicSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	tags: z.array(z.string()).nullable(),
	created_at: z.string(),
	rasterLayer: z.record(z.string(), z.unknown()),
	footprint: z.string(),
	sizeInBytes: count,
	status_summary: statusSummarySchema,
});
export const mosaicSummarySchema = mosaicSchema.omit({
	footprint: true,
	rasterLayer: true,
});
export const geometryDetailsSchema = z.object({
	geometry: aoiSchema,
	bbox: z.array(z.number()).length(4),
	areaM2: z.number().nonnegative(),
	areaKm2: z.number().nonnegative(),
});
export const mosaicDetailsSchema = mosaicSchema
	.omit({ footprint: true })
	.extend({
		geometry: aoiSchema.nullable(),
		bbox: z.array(z.number()).length(4).nullable(),
		areaM2: z.number().nullable(),
		areaKm2: z.number().nullable(),
		warnings: z.array(z.string()),
	});
export const mosaicImageStatusSchema = z.object({
	image_id: z.uuid(),
	filename: z.string(),
	preprocessing_status: z.string(),
	preprocessing_error: z.string().nullish(),
	data_available: z.boolean(),
	tiles_ready: z.boolean().default(false),
	uploaded_at: z.string(),
	state: z.string().nullish(),
});
export const mosaicStatusSchema = z.object({
	mosaic_id: z.uuid(),
	total_images: count,
	ready_images: count,
	pending_images: count,
	in_progress_images: count,
	failed_images: count,
	loading_images: count.default(0),
	tiles_ready_images: count,
	images: z.array(mosaicImageStatusSchema),
});
export const mosaicStatusOutputSchema = mosaicStatusSchema
	.omit({ images: true })
	.extend({
		images: z.array(mosaicImageStatusSchema).optional(),
		ready: z.boolean(),
		warnings: z.array(z.string()),
	});
export const costDetailsSchema = z.object({
	dataCost: z.number().nonnegative(),
	processingCost: z.number().nonnegative(),
});
export const costOutputSchema = costDetailsSchema.extend({
	cost: z.number().nonnegative(),
	unit: z.literal("credits"),
	preliminary: z.boolean(),
});
export const catalogImageSchema = z.object({
	id: z.string(),
	satId: z.string().nullish(),
	pixelResolution: nullableNumber,
	acquisitionDate: z.string().nullish(),
	productType: z.string().nullish(),
	sensor: z.string().nullish(),
	cloudCover: nullableNumber,
	offNadirAngle: nullableNumber,
	previewUrl: z.string().nullish(),
	providerName: z.string().nullish(),
	zoom: nullableNumber,
	aoiIntersectionPercent: nullableNumber,
	minAreaSqkm: nullableNumber,
});
export const catalogResponseSchema = z.object({
	images: z.array(catalogImageSchema),
	total: count,
	errors: z.unknown().optional(),
});
export const statisticsRowSchema = z.object({
	key: z.string(),
	count,
	area: nullableNumber,
	length: nullableNumber,
});
export const statisticsSchema = z.object({
	processingId: z.uuid(),
	status: z.enum(["READY", "COMPUTING", "FAILED"]),
	computedAt: z.string().nullish(),
	isDefault: z.boolean(),
	wdName: z.string(),
	totalCount: count,
	totalArea: nullableNumber,
	aoiArea: z.number().nonnegative(),
	groups: z.array(
		statisticsRowSchema.extend({
			geometryType: z.string().nullable(),
			classes: z.array(statisticsRowSchema).nullish(),
		}),
	),
});
const units = {
	areaM2: z.number().nullable(),
	areaKm2: z.number().nullable(),
	lengthM: z.number().nullable(),
	lengthKm: z.number().nullable(),
};
const rowOutput = statisticsRowSchema
	.omit({ area: true, length: true })
	.extend(units);
export const statisticsOutputSchema = statisticsSchema
	.omit({ totalArea: true, aoiArea: true, groups: true })
	.extend({
		totalAreaM2: z.number().nullable(),
		totalAreaKm2: z.number().nullable(),
		aoiAreaM2: z.number(),
		aoiAreaKm2: z.number(),
		groups: z.array(
			rowOutput.extend({
				geometryType: z.string().nullable(),
				classes: z.array(rowOutput),
			}),
		),
	});
export function restPageSchema<T extends z.ZodType>(item: T) {
	return z.object({ results: z.array(item), total: count, count });
}
export function pageOutputSchema<T extends z.ZodType>(item: T) {
	return z.object({
		items: z.array(item),
		total: count,
		count,
		limit: count,
		offset: count,
		hasNext: z.boolean(),
	});
}
export const mosaicPageSchema = z.object({
	items: z.array(mosaicSchema),
	total: count,
	limit: count,
	offset: count,
	has_next: z.boolean(),
});
