import * as z from "zod";
import * as api from "./api-schemas.js";
import { parseFootprint } from "./geometry.js";
import * as input from "./inputs.js";
import { ApiError, type ApiTransport } from "./transport.js";

function page<T>(items: T[], total: number, limit: number, offset: number) {
	return {
		items,
		total,
		count: items.length,
		limit,
		offset,
		hasNext: offset + items.length < total,
	};
}
function units(row: { area?: number | null; length?: number | null }) {
	return {
		areaM2: row.area ?? null,
		areaKm2: row.area == null ? null : row.area / 1e6,
		lengthM: row.length ?? null,
		lengthKm: row.length == null ? null : row.length / 1000,
	};
}
export function createReadClient(http: ApiTransport) {
	const getMosaicStatus = async (mosaicId: string, includeImages = false) => {
		const v = await http.requestJson(
			`/rest/rasters/mosaic/${mosaicId}/status`,
			api.mosaicStatusSchema,
		);
		const { images, ...counts } = v;
		return {
			...counts,
			ready:
				v.ready_images > 0 &&
				v.pending_images === 0 &&
				v.in_progress_images === 0 &&
				v.loading_images === 0,
			warnings:
				v.failed_images > 0
					? [
							`${v.failed_images} image(s) failed; only ready imagery can be processed.`,
						]
					: [],
			...(includeImages ? { images } : {}),
		};
	};
	return {
		getMosaicStatus,
		async listProjects(args: z.input<typeof input.listProjectsSchema>) {
			const { query, ...filters } = input.listProjectsSchema.parse(args);
			const schema = api.restPageSchema(api.projectSchema);
			const body = { ...filters, filter: query };
			const data = await http.post("/rest/projects/page", schema, body);
			// WM's COUNT OVER can report zero for an offset beyond the last row.
			const total =
				data.results.length === 0 && filters.offset > 0
					? (
							await http.post("/rest/projects/page", schema, {
								...body,
								offset: 0,
								limit: 1,
							})
						).total
					: data.total;
			return page(
				data.results.map(({ workflowDefs: _, ...p }) => p),
				total,
				filters.limit,
				filters.offset,
			);
		},
		getProject(projectId: string) {
			return http.requestJson(`/rest/projects/${projectId}`, api.projectSchema);
		},
		async listMosaics(args: z.input<typeof input.listMosaicsSchema>) {
			const v = input.listMosaicsSchema.parse(args);
			const q = new URLSearchParams({
				limit: String(v.limit),
				offset: String(v.offset),
				sort: v.sortBy,
				order: v.sortOrder,
			});
			if (v.nameContains) q.set("name_contains", v.nameContains);
			for (const tag of v.tags ?? []) q.append("tags", tag);
			const data = await http.requestJson(
				`/rest/rasters/mosaic/page?${q}`,
				api.mosaicPageSchema,
			);
			return {
				...page(
					data.items.map((m) => api.mosaicSummarySchema.parse(m)),
					data.total,
					data.limit,
					data.offset,
				),
				hasNext: data.has_next,
			};
		},
		async getMosaic(mosaicId: string) {
			const { footprint, ...mosaic } = await http.requestJson(
				`/rest/rasters/mosaic/${mosaicId}`,
				api.mosaicSchema,
			);
			return { ...mosaic, ...parseFootprint(footprint) };
		},
		async listProcessings(args: z.input<typeof input.listProcessingsSchema>) {
			const { projectId, query, ...filters } =
				input.listProcessingsSchema.parse(args);
			const data = await http.post(
				`/rest/projects/${projectId}/processings/v2/page`,
				api.restPageSchema(api.processingSchema),
				{ ...filters, terms: query },
			);
			const items = data.results.map((p) =>
				api.processingSummarySchema.parse({
					...p,
					model:
						typeof p.workflowDef?.name === "string" ? p.workflowDef.name : null,
					imagery: p.params?.sourceParams ?? null,
				}),
			);
			return page(items, data.total, filters.limit, filters.offset);
		},
		async getProcessingStatistics(processingId: string) {
			const v = await http.requestJson(
				`/rest/processings/${processingId}/statistics`,
				api.statisticsSchema,
			);
			const { groups, totalArea, aoiArea, ...rest } = v;
			return {
				...rest,
				totalAreaM2: totalArea ?? null,
				totalAreaKm2: totalArea == null ? null : totalArea / 1e6,
				aoiAreaM2: aoiArea,
				aoiAreaKm2: aoiArea / 1e6,
				groups: groups.map(({ area, length, classes, ...g }) => ({
					...g,
					...units({ area, length }),
					classes: (classes ?? []).map(({ area, length, ...c }) => ({
						...c,
						...units({ area, length }),
					})),
				})),
			};
		},
		async searchImageryCatalog(
			args: z.input<typeof input.searchCatalogSchema>,
		) {
			const { geometry, acquisitionDateFrom, acquisitionDateTo, ...filters } =
				input.searchCatalogSchema.parse(args);
			const data = await http.post(
				"/rest/catalog/meta",
				api.catalogResponseSchema,
				{
					...filters,
					aoi: geometry,
					acquisitionDateFrom: input.toInstant(acquisitionDateFrom),
					acquisitionDateTo: input.toInstant(acquisitionDateTo, true),
					returnErrors: true,
				},
			);
			return {
				...page(data.images, data.total, filters.limit, filters.offset),
				providerErrors: data.errors ?? null,
			};
		},
		async getImageMetadata(args: z.input<typeof input.imageMetadataSchema>) {
			const { imageId, dataProvider, zoom } =
				input.imageMetadataSchema.parse(args);
			if (dataProvider === "maxar")
				return http.requestJson(
					`/rest/catalog/meta/${encodeURIComponent(imageId)}`,
					api.catalogImageSchema,
				);
			const provider = dataProvider?.startsWith("orbview")
				? "orbview"
				: dataProvider === "arcgis_world_imagery" ||
						dataProvider?.startsWith("CG_mosaic_")
					? "cgmosaic"
					: dataProvider;
			const query = new URLSearchParams();
			if (provider) query.set("provider_name", provider);
			const images = await http.requestJson(
				`/rest/catalog/${encodeURIComponent(imageId)}${query.size ? `?${query}` : ""}`,
				z.array(api.catalogImageSchema),
			);
			const matches = images.filter(
				(image) =>
					image.id === imageId && (zoom === undefined || image.zoom === zoom),
			);
			if (matches.length === 0)
				throw new ApiError(
					"No catalog image matches the requested ID and zoom",
					"NOT_FOUND",
				);
			if (matches.length !== 1)
				throw new ApiError(
					"Multiple catalog images match; specify dataProvider and zoom from search-imagery-catalog",
					"AMBIGUOUS_IMAGE",
				);
			return matches[0];
		},
	};
}
