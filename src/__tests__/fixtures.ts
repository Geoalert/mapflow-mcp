export const id = "550e8400-e29b-41d4-a716-446655440000";
export const geometry: { type: "Polygon"; coordinates: [number, number][][] } =
	{
		type: "Polygon",
		coordinates: [
			[
				[0, 0],
				[0.01, 0],
				[0.01, 0.01],
				[0, 0.01],
				[0, 0],
			],
		],
	};
export const user = {
	models: [{ id, name: "Buildings" }],
	dataProviders: [{ name: "Mapbox" }],
	remainingCredits: 100,
};
export const processing = {
	id,
	projectId: id,
	name: "Buildings test",
	status: "OK",
	cost: 10,
	workflowDef: { name: "Buildings" },
	params: { sourceParams: { dataProvider: { providerName: "Mapbox" } } },
};
export const project = {
	id,
	name: "Test project",
	isDefault: true,
	area: 100,
	user: { email: "private@example.com" },
};
export const mosaic = {
	id,
	name: "Upload",
	tags: null,
	created_at: "2026-10-14T00:00:00Z",
	rasterLayer: { tileUrl: "https://example.com/{z}/{x}/{y}" },
	footprint: "POLYGON ((0 0, 0.01 0, 0.01 0.01, 0 0.01, 0 0))",
	sizeInBytes: 100,
	status_summary: { total: 2, ready: 1, pending: 0, in_progress: 0, failed: 1 },
};
export const mosaicStatus = {
	mosaic_id: id,
	total_images: 2,
	ready_images: 1,
	pending_images: 0,
	in_progress_images: 0,
	failed_images: 1,
	loading_images: 0,
	tiles_ready_images: 0,
	images: [
		{
			image_id: id,
			filename: "test.tif",
			preprocessing_status: "COMPLETED",
			data_available: true,
			tiles_ready: false,
			uploaded_at: "2026-10-14T00:00:00Z",
		},
	],
};
export const image = {
	id: "opaque/image:1",
	providerName: "roscosmos",
	pixelResolution: 0.5,
	previewUrl: "https://example.com/preview.jpg",
};
export const statistics = {
	processingId: id,
	status: "READY",
	computedAt: null,
	isDefault: true,
	wdName: "Buildings",
	totalCount: 2,
	totalArea: 300,
	aoiArea: 1000,
	groups: [
		{
			key: "buildings",
			geometryType: "POLYGON",
			count: 2,
			area: 300,
			length: null,
			classes: [{ key: "residential", count: 2, area: 300, length: null }],
		},
	],
};
export function apiFixture(url: URL): unknown {
	const path = url.pathname;
	if (path === "/rest/user/status") return user;
	if (path === "/rest/projects/page")
		return { results: [project], total: 1, count: 1 };
	if (path.endsWith("/processings/v2/page"))
		return { results: [processing], total: 1, count: 1 };
	if (path.startsWith("/rest/projects/")) return project;
	if (path === "/rest/rasters/mosaic/page")
		return { items: [mosaic], total: 1, limit: 20, offset: 0, has_next: false };
	if (path.endsWith("/status")) return mosaicStatus;
	if (path.startsWith("/rest/rasters/mosaic/")) return mosaic;
	if (path.endsWith("/statistics")) return statistics;
	if (path === "/rest/processing/cost/details/v2")
		return { dataCost: 3, processingCost: 7 };
	if (path.startsWith("/rest/processings")) return processing;
	if (path === "/rest/catalog/meta")
		return {
			images: [image],
			total: 1,
			errors: [{ providerName: "orbview", message: "temporarily unavailable" }],
		};
	if (path.startsWith("/rest/catalog/meta/")) return image;
	throw new Error(`Unexpected test route: ${path}`);
}
