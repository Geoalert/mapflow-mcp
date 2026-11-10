import * as z from "zod";
import * as api from "./api-schemas.js";
import { aoiSchema } from "./geometry.js";
import type { createGeometryOutput } from "./geometry-output.js";
import {
	geometrySummarySchema,
	outputNoticeFields,
} from "./geometry-output.js";

type Presenter = ReturnType<typeof createGeometryOutput>;
export const catalogImageOutputSchema = api.catalogImageSchema.extend({
	footprint: aoiSchema.optional(),
	footprintSummary: geometrySummarySchema.nullable(),
	previews: z
		.array(
			z.object({
				url: z.string(),
				geometry: aoiSchema.optional(),
				geometrySummary: geometrySummarySchema.nullable(),
			}),
		)
		.nullish(),
});
export const imageOutputSchema =
	catalogImageOutputSchema.extend(outputNoticeFields);
export const catalogOutputSchema = api
	.pageOutputSchema(catalogImageOutputSchema)
	.extend({ providerErrors: z.unknown(), ...outputNoticeFields });
export const mosaicOutputSchema = api.mosaicDetailsSchema.extend({
	geometry: aoiSchema.optional(),
	geometrySummary: geometrySummarySchema.nullable(),
	...outputNoticeFields,
});
export function presentImage(
	image: z.infer<typeof api.catalogImageSchema>,
	presenter: Presenter,
) {
	const { footprint, previews, ...metadata } = image;
	const contour = presenter.present(footprint);
	const result: Record<string, unknown> = {
		...metadata,
		footprintSummary: contour?.summary ?? null,
		previews:
			previews?.map(({ geometry, url }) => {
				const preview = presenter.present(geometry);
				const part: Record<string, unknown> = {
					url,
					geometrySummary: preview?.summary ?? null,
				};
				presenter.attach(part, "geometry", preview);
				return part;
			}) ?? previews,
	};
	presenter.attach(result, "footprint", contour);
	return result;
}
