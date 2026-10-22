import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { aoiSchema, bufferGeometry, parseFootprint } from "../geometry.js";
import {
	calculateCostRequestSchema,
	createProcessingRequestSchema,
} from "../inputs.js";
import { createMapflowClient } from "../mapflow-client.js";
import {
	apiFixture,
	geometry,
	id,
	mosaic,
	mosaicStatus,
	user,
} from "./fixtures.js";

const originalFetch = globalThis.fetch;
let calls: {
	path: string;
	body: Record<string, unknown>;
	auth: string | undefined;
}[];
let override:
	| ((url: URL, body: Record<string, unknown>) => Response | undefined)
	| undefined;
beforeEach(() => {
	calls = [];
	override = undefined;
	globalThis.fetch = mock(async (url: URL, init?: RequestInit) => {
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({
			path: url.pathname,
			body,
			auth: (init?.headers as Record<string, string>).Authorization,
		});
		return override?.(url, body) ?? Response.json(apiFixture(url));
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const config = {
	name: "Test",
	wdName: "Buildings",
	geometry,
	blocks: [{ name: "simplify", enabled: true }],
	inferenceParams: { threshold: "0.5" },
};
for (const source of [
	{ type: "provider" as const, name: "Mapbox", zoom: 18 },
	{
		type: "catalog" as const,
		dataProvider: "roscosmos" as const,
		imageIds: ["scene-1"],
		zoom: 18,
	},
	{ type: "myImagery" as const, mosaicId: id },
])
	test(`estimate/start preserve configuration for ${source.type}`, async () => {
		const client = createMapflowClient("token");
		const { name: _, ...estimate } = config;
		await client.calculateCost({ ...estimate, source });
		const result = await client.createProcessing({ ...config, source });
		const cost = calls.find(
			(c) => c.path === "/rest/processing/cost/details/v2",
		)?.body;
		const start = calls.find((c) => c.path === "/rest/processings/v2")?.body;
		expect(cost?.geometry).toEqual(start?.geometry);
		expect(cost?.blocks).toEqual(start?.blocks);
		if (source.type === "myImagery") {
			expect(cost?.params).toEqual({
				sourceParams: { myImagery: {} },
				inferenceParams: config.inferenceParams,
			});
			expect(start?.params).toEqual({
				sourceParams: { myImagery: { mosaicId: id } },
				inferenceParams: config.inferenceParams,
			});
			expect(result.warnings).toHaveLength(1);
		} else expect(cost?.params).toEqual(start?.params);
		await client.getModels();
		expect(calls.filter((c) => c.path === "/rest/user/status")).toHaveLength(2);
	});
for (const counter of [
	"pending_images",
	"in_progress_images",
	"loading_images",
])
	test(`${counter} prevents a paid start`, async () => {
		override = (u) =>
			u.pathname.endsWith("/status") && u.pathname !== "/rest/user/status"
				? Response.json({ ...mosaicStatus, [counter]: 1 })
				: undefined;
		await expect(
			createMapflowClient("t").createProcessing({
				...config,
				source: { type: "myImagery", mosaicId: id },
			}),
		).rejects.toThrow("not ready");
		expect(calls.some((c) => c.path === "/rest/processings/v2")).toBe(false);
	});
test("empty/all-failed mosaic is not ready; per-image details are opt-in", async () => {
	override = (u) =>
		u.pathname.includes("/mosaic/")
			? Response.json({ ...mosaicStatus, ready_images: 0 })
			: undefined;
	const client = createMapflowClient("t");
	const status = await client.getMosaicStatus(id, true);
	expect(status.ready).toBe(false);
	expect(status.images).toHaveLength(1);
});
test("POST transport failure is not retried and reports unknown outcome", async () => {
	override = (u) => {
		if (u.pathname === "/rest/processings/v2") throw new Error("network");
		return undefined;
	};
	await expect(
		createMapflowClient("t").createProcessing({
			...config,
			source: { type: "provider", name: "Mapbox" },
		}),
	).rejects.toThrow("outcome is unknown");
	expect(calls.filter((c) => c.path === "/rest/processings/v2")).toHaveLength(
		1,
	);
});
test("account caches are isolated and balance is always fresh", async () => {
	const a = createMapflowClient("a"),
		b = createMapflowClient("b");
	await a.getModels();
	await a.getModels();
	await b.getModels();
	await a.getLimits();
	await a.getLimits();
	expect(calls.map((c) => c.auth)).toEqual([
		"Basic a",
		"Basic b",
		"Basic a",
		"Basic a",
	]);
});
test("unknown provider and model fail before posting", async () => {
	const client = createMapflowClient("t");
	await expect(
		client.createProcessing({
			...config,
			source: { type: "provider", name: "Unknown" },
		}),
	).rejects.toThrow("not available");
	await expect(
		client.calculateCost({ wdName: "Unknown", areaSqKm: 1 }),
	).rejects.toThrow("Model not found");
	expect(calls.every((c) => c.path === "/rest/user/status")).toBe(true);
});
test("pagination beyond last project recovers true total; no user data leaks", async () => {
	override = (u, b) =>
		u.pathname === "/rest/projects/page"
			? Response.json({ results: [], count: 0, total: b.offset === 0 ? 42 : 0 })
			: undefined;
	const result = await createMapflowClient("t").listProjects({ offset: 100 });
	expect(result).toMatchObject({
		items: [],
		total: 42,
		hasNext: false,
		offset: 100,
	});
	expect(calls).toHaveLength(2);
});
test("empty catalog and processing pages remain successful", async () => {
	override = (u) =>
		u.pathname === "/rest/catalog/meta"
			? Response.json({ images: [], total: 0 })
			: Response.json({ results: [], total: 0, count: 0 });
	const client = createMapflowClient("t");
	expect(await client.searchImageryCatalog({ geometry })).toMatchObject({
		items: [],
		total: 0,
		hasNext: false,
	});
	expect(await client.listProcessings({ projectId: id })).toMatchObject({
		items: [],
		total: 0,
		hasNext: false,
	});
});
test("invalid footprint gives null geometry with a warning", async () => {
	override = () => Response.json({ ...mosaic, footprint: "nonsense" });
	const result = await createMapflowClient("t").getMosaic(id);
	expect(result.geometry).toBeNull();
	expect(result.warnings).toHaveLength(1);
});
test("malformed costs fail closed instead of returning NaN", async () => {
	override = (u) =>
		u.pathname === "/rest/user/status"
			? Response.json(user)
			: Response.json({ dataCost: "invalid", processingCost: 1 });
	await expect(
		createMapflowClient("t").calculateCost({
			wdName: "Buildings",
			areaSqKm: 1,
		}),
	).rejects.toThrow("unexpected response");
});
test("legacy source works; partial source and non-string inference do not", () => {
	expect(
		createProcessingRequestSchema.safeParse({
			...config,
			dataProvider: { name: "Mapbox", zoom: 18 },
		}).success,
	).toBe(true);
	expect(createProcessingRequestSchema.safeParse(config).success).toBe(false);
	expect(
		calculateCostRequestSchema.safeParse({
			wdName: "Buildings",
			areaSqKm: 1,
			source: { type: "myImagery", mosaicId: id },
		}).success,
	).toBe(false);
});
test("geometry rejects invalid ranges, unclosed rings and self intersections", () => {
	for (const coordinates of [
		[
			[
				[181, 0],
				[181, 1],
				[179, 1],
				[181, 0],
			],
		],
		[
			[
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 1],
			],
		],
		[
			[
				[0, 0],
				[1, 1],
				[0, 1],
				[1, 0],
				[0, 0],
			],
		],
	])
		expect(aoiSchema.safeParse({ type: "Polygon", coordinates }).success).toBe(
			false,
		);
	const before = JSON.stringify(geometry);
	bufferGeometry(geometry, 100);
	expect(JSON.stringify(geometry)).toBe(before);
	const point = bufferGeometry({ type: "Point", coordinates: [0, 0] }, 100);
	expect(point.areaM2).toBeGreaterThan(30000);
	expect(point.areaM2).toBeLessThan(33000);
	expect(parseFootprint(JSON.stringify(geometry)).geometry).toEqual(geometry);
	expect(parseFootprint("POLYGON EMPTY").geometry).toBeNull();
});

test("projected footprint CRS is not silently treated as WGS84", () => {
	expect(parseFootprint(`SRID=3857;${mosaic.footprint}`).geometry).toBeNull();
	expect(parseFootprint(`SRID=4326;${mosaic.footprint}`).geometry).toEqual(
		geometry,
	);
	expect(
		aoiSchema.safeParse({
			...geometry,
			crs: { type: "name", properties: { name: "EPSG:3857" } },
		}).success,
	).toBe(false);
});

for (const malformed of ["not json", JSON.stringify({ accepted: true })])
	test("malformed launch acknowledgement leaves the outcome unknown", async () => {
		override = (u) =>
			u.pathname === "/rest/processings/v2"
				? new Response(malformed)
				: undefined;
		await expect(
			createMapflowClient("t").createProcessing({
				...config,
				source: { type: "provider", name: "Mapbox" },
			}),
		).rejects.toThrow("outcome is unknown");
		expect(calls.filter((c) => c.path === "/rest/processings/v2")).toHaveLength(
			1,
		);
	});
