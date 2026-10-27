import * as z from "zod";
import { aoiSchema, geometrySchema } from "./geometry.js";

const text = z.string().trim().min(1);
const zoom = z.number().int().min(0).max(30).optional();
export const catalogProviders = [
	"orbview",
	"orbview_obs",
	"orbview_sv1",
	"orbview_sv2",
	"orbview_bj2",
	"orbview_bj3a",
	"orbview_bj3n",
	"orbview_svn1",
	"orbview_svn3",
	"arcgis_world_imagery",
	"cg_mosaic_2022",
	"cg_mosaic_2024",
	"cg_mosaic_2025",
	"roscosmos",
	"skywatch",
] as const;
export const searchProviders = [
	"arcgis_world_imagery",
	"CG_mosaic_2021",
	"CG_mosaic_2022",
	"CG_mosaic_2024",
	"orbview",
	"orbview_obs",
	"orbview_sv1",
	"orbview_sv2",
	"orbview_bj2",
	"orbview_bj3a",
	"orbview_bj3n",
	"orbview_svn1",
	"orbview_svn3",
	"roscosmos",
	"skywatch",
	"skywatch_spot",
	"skywatch_pleiades",
	"skywatch_pleiades_neo",
] as const;
export const sourceSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("provider"), name: text, zoom }),
	z.strictObject({
		type: z.literal("catalog"),
		dataProvider: z.enum(catalogProviders),
		imageIds: z.array(text).min(1),
		zoom,
	}),
	z.strictObject({ type: z.literal("myImagery"), mosaicId: z.uuid() }),
]);
export type Source = z.infer<typeof sourceSchema>;
const sourceFields = {
	source: sourceSchema.optional(),
	dataProvider: z
		.strictObject({ name: text, zoom: z.number().int().min(0).max(30) })
		.optional()
		.describe(
			"Deprecated alias for source.type=provider. Do not combine with source.",
		),
};
const processingFields = {
	wdName: text,
	...sourceFields,
	blocks: z
		.array(z.strictObject({ name: text, enabled: z.boolean() }))
		.optional(),
	inferenceParams: z.record(z.string(), z.string()).optional(),
};
function validateSource(
	v: { source?: Source; dataProvider?: { name: string } },
	ctx: z.RefinementCtx,
) {
	if (v.source && v.dataProvider)
		ctx.addIssue({
			code: "custom",
			message: "Provide source or dataProvider, never both",
			path: ["source"],
		});
}
export const createProcessingRequestSchema = z
	.strictObject({
		...processingFields,
		name: text.max(128),
		geometry: aoiSchema,
		projectId: z.uuid().optional(),
		meta: z.record(z.string(), z.string()).optional(),
	})
	.superRefine((v, ctx) => {
		validateSource(v, ctx);
		if (!v.source && !v.dataProvider)
			ctx.addIssue({
				code: "custom",
				message: "source is required",
				path: ["source"],
			});
	});
export const calculateCostRequestSchema = z
	.strictObject({
		...processingFields,
		geometry: aoiSchema.optional(),
		areaSqKm: z.number().positive().optional(),
	})
	.superRefine((v, ctx) => {
		validateSource(v, ctx);
		if ((v.geometry === undefined) === (v.areaSqKm === undefined))
			ctx.addIssue({
				code: "custom",
				message: "Provide exactly one of geometry or areaSqKm",
				path: ["geometry"],
			});
		if (v.source && v.source.type !== "provider" && !v.geometry)
			ctx.addIssue({
				code: "custom",
				message: "Catalog and My Imagery require geometry",
				path: ["geometry"],
			});
		if (v.inferenceParams && !v.source && !v.dataProvider)
			ctx.addIssue({
				code: "custom",
				message: "inferenceParams requires source",
				path: ["source"],
			});
	});
export type CreateProcessingRequest = z.input<
	typeof createProcessingRequestSchema
>;
export type CalculateCostRequest = z.input<typeof calculateCostRequestSchema>;
export const pagination = {
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
};
const order = z.enum(["ASC", "DESC"]);
export const listProjectsSchema = z.strictObject({
	...pagination,
	query: text.optional(),
	sortBy: z.enum(["NAME", "CREATED", "UPDATED"]).default("UPDATED"),
	sortOrder: order.default("DESC"),
});
export const getProjectSchema = z.strictObject({
	projectId: z.union([z.uuid(), z.literal("default")]),
});
export const listMosaicsSchema = z.strictObject({
	...pagination,
	nameContains: text.max(255).optional(),
	tags: z.array(text).optional(),
	sortBy: z.enum(["created_at", "name", "size_in_bytes"]).default("created_at"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export const getMosaicSchema = z.strictObject({ mosaicId: z.uuid() });
export const getMosaicStatusSchema = z.strictObject({
	mosaicId: z.uuid(),
	includeImages: z.boolean().default(false),
});
export const processingIdSchema = z.strictObject({ processingId: z.uuid() });
export const listProcessingsSchema = z
	.strictObject({
		...pagination,
		projectId: z.uuid(),
		query: text.optional(),
		statuses: z
			.array(
				z.enum([
					"UNPROCESSED",
					"PENDING",
					"IN_PROGRESS",
					"OK",
					"FAILED",
					"CANCELLED",
					"REFUNDED",
					"AWAITING",
				]),
			)
			.min(1)
			.optional(),
		dateFrom: z.iso.datetime({ offset: true }).optional(),
		dateTo: z.iso.datetime({ offset: true }).optional(),
		sortBy: z
			.enum([
				"NAME",
				"CREATED",
				"UPDATED",
				"COMPLETED",
				"STATUS",
				"PROGRESS",
				"COST",
				"AREA",
				"PROVIDER",
			])
			.default("CREATED"),
		sortOrder: order.default("DESC"),
	})
	.refine(
		(v) =>
			!v.dateFrom ||
			!v.dateTo ||
			Date.parse(v.dateFrom) <= Date.parse(v.dateTo),
		"dateFrom must not exceed dateTo",
	);
const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export function toInstant(value: string | undefined, end = false) {
	return value?.length === 10
		? `${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`
		: value;
}
export const searchCatalogSchema = z
	.strictObject({
		...pagination,
		geometry: aoiSchema,
		acquisitionDateFrom: date.optional(),
		acquisitionDateTo: date.optional(),
		maxCloudCover: z.number().min(0).max(100).optional(),
		minResolution: z.number().positive().optional(),
		maxResolution: z.number().positive().optional(),
		minOffNadirAngle: z.number().min(0).max(90).optional(),
		maxOffNadirAngle: z.number().min(0).max(90).optional(),
		minAoiIntersectionPercent: z.number().min(0).max(100).optional(),
		dataProviders: z.array(z.enum(searchProviders)).min(1).optional(),
		hideUnavailable: z.boolean().default(true),
		sortBy: z
			.enum([
				"ACQUISITION_DATE",
				"CLOUD_COVER",
				"OFF_NADIR_ANGLE",
				"PIXEL_RESOLUTION",
				"SAT_ID",
				"ZOOM",
				"PROVIDER_NAME",
			])
			.default("CLOUD_COVER"),
		sortOrder: order.default("ASC"),
	})
	.superRefine((v, ctx) => {
		for (const [min, max] of [
			[v.minResolution, v.maxResolution],
			[v.minOffNadirAngle, v.maxOffNadirAngle],
		])
			if (min !== undefined && max !== undefined && min > max)
				ctx.addIssue({
					code: "custom",
					message: "Lower bound must not exceed upper bound",
				});
		const from = toInstant(v.acquisitionDateFrom);
		const to = toInstant(v.acquisitionDateTo, true);
		if (from && to && Date.parse(from) > Date.parse(to))
			ctx.addIssue({ code: "custom", message: "Date range is reversed" });
	});
export const imageMetadataSchema = z.strictObject({
	imageId: text,
	dataProvider: z.enum([...searchProviders, "maxar"]).optional(),
	zoom,
});
export const geoboundarySchema = z.strictObject({
	query: text,
	bufferMeters: z.number().nonnegative().optional(),
});
export const bufferAoiSchema = z.strictObject({
	geometry: geometrySchema,
	distanceMeters: z.number().positive(),
});
