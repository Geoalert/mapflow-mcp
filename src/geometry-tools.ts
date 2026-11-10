import * as z from "zod";
import { geometryDetailsSchema } from "./api-schemas.js";
import type { GeometryCache } from "./geometry-cache.js";
import * as input from "./inputs.js";

// These are MCP wire schemas. The original API schema is always parsed after
// resolving the reference, preserving its cross-field/business refinements.
function withGeometryId<S extends z.ZodRawShape & { geometry: z.ZodType }>(
	schema: z.ZodObject<S>,
	allowArea = false,
) {
	return z
		.strictObject({
			...schema.shape,
			geometry: schema.shape.geometry.optional(),
			geometryId: z
				.uuid()
				.optional()
				.describe(
					"Cached geometry from get-geoboundary or buffer-aoi. Supply geometry OR geometryId, never both.",
				),
		})
		.superRefine((value, ctx) => {
			const area =
				allowArea && "areaSqKm" in value && value.areaSqKm !== undefined;
			const count =
				Number("geometry" in value && value.geometry !== undefined) +
				Number("geometryId" in value && value.geometryId !== undefined) +
				Number(area);
			if (count !== 1)
				ctx.addIssue({
					code: "custom",
					message: allowArea
						? "Provide exactly one of geometry, geometryId or areaSqKm"
						: "Provide exactly one of geometry or geometryId",
				});
		});
}

export const searchCatalogToolSchema = withGeometryId(
	input.searchCatalogSchema,
);
export const calculateCostToolSchema = withGeometryId(
	input.calculateCostRequestSchema,
	true,
);
export const createProcessingToolSchema = withGeometryId(
	input.createProcessingRequestSchema,
);
const includeGeometry = z
	.boolean()
	.default(false)
	.describe(
		"Include full GeoJSON in addition to geometryId. Defaults to a compact summary.",
	);
export const geoboundaryToolSchema = input.geoboundarySchema.extend({
	includeGeometry,
});
export const bufferAoiToolSchema = withGeometryId(
	input.bufferAoiSchema.extend({ includeGeometry }),
);
export const cachedGeometrySchema = geometryDetailsSchema.extend({
	geometry: geometryDetailsSchema.shape.geometry.optional(),
	geometryId: z.uuid(),
	expiresAt: z.iso.datetime(),
});

export function resolveGeometry<
	T extends { geometry?: unknown; geometryId?: string },
>(args: T, cache: GeometryCache, owner: () => string) {
	const { geometryId, ...rest } = args;
	return geometryId === undefined
		? rest
		: { ...rest, geometry: cache.get(owner(), geometryId) };
}
