import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as z from "zod";
import { createMapflowClient } from "../mapflow-client.js";
import { createServer } from "../mcp-server.js";
import {
	apiFixture,
	geometry,
	id,
	image,
	processing,
	statistics,
	user,
} from "./fixtures.js";

const originalFetch = globalThis.fetch;
let client: Client;
let server: ReturnType<typeof createServer>;
let requests: {
	url: URL;
	method: string;
	body: unknown;
	headers: RequestInit["headers"];
}[];
let responseOverride: ((url: URL) => Response | undefined) | undefined;
beforeEach(async () => {
	requests = [];
	responseOverride = undefined;
	globalThis.fetch = mock(
		async (url: string | URL | Request, init?: RequestInit) => {
			const u = new URL(String(url));
			requests.push({
				url: u,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
				headers: init?.headers,
			});
			return responseOverride?.(u) ?? Response.json(apiFixture(u));
		},
	) as unknown as typeof fetch;
	const api = createMapflowClient("test-token");
	server = createServer({
		getClient: () => api,
		geometryOwner: "test-user",
		nominatim: {
			searchBoundary: async () => ({
				place_id: 1,
				display_name: "Test place",
				lat: "0",
				lon: "0",
				geojson: geometry,
			}),
		},
	});
	client = new Client({ name: "contract-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(b);
	await client.connect(a);
});
afterEach(async () => {
	await client.close();
	await server.close();
	globalThis.fetch = originalFetch;
});
const calls: [string, Record<string, unknown>][] = [
	["list-models", {}],
	["list-imagery-sources", {}],
	["get-limits", {}],
	["list-projects", { query: "Test" }],
	["create-project", { name: " Test project ", description: "MCP test" }],
	["get-project", { projectId: "default" }],
	["list-mosaics", { tags: ["one", "two"], nameContains: "Upload" }],
	["get-mosaic", { mosaicId: id }],
	["get-mosaic-status", { mosaicId: id }],
	["list-processings", { projectId: id, query: "Buildings" }],
	["get-processing", { processingId: id }],
	["get-processing-result", { processingId: id }],
	["get-processing-statistics", { processingId: id }],
	[
		"search-imagery-catalog",
		{
			geometry,
			acquisitionDateFrom: "2026-10-01",
			acquisitionDateTo: "2026-10-14",
		},
	],
	["get-image-metadata", { imageId: "opaque/image:1" }],
	["get-geoboundary", { query: "Test" }],
	["buffer-aoi", { geometry, distanceMeters: 100 }],
	[
		"calculate-cost",
		{
			wdName: "Buildings",
			geometry,
			source: { type: "provider", name: "Mapbox", zoom: 18 },
		},
	],
	[
		"start-processing",
		{
			name: "Test",
			wdName: "Buildings",
			geometry,
			source: { type: "provider", name: "Mapbox", zoom: 18 },
		},
	],
];
test("account tools accept nullable provider previews in user status", async () => {
	const dataProviders = [
		{ name: "Google", previewUrlMaxZoom: null },
		{ name: "Maps_gov_il", previewUrl: null, previewUrlMaxZoom: null },
	];
	responseOverride = (url) =>
		url.pathname === "/rest/user/status"
			? Response.json({ ...user, dataProviders })
			: undefined;
	for (const [name, expected] of [
		["get-limits", { remainingCredits: user.remainingCredits }],
		["list-models", { models: user.models }],
		["list-imagery-sources", { imagerySources: dataProviders }],
	] as const) {
		const result = await client.callTool({ name, arguments: {} });
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject(expected);
	}
});
test("discovery publishes numeric coordinate arrays while runtime rejects invalid positions", async () => {
	const { tools } = await client.listTools();
	let positions = 0;
	function inspect(value: unknown) {
		if (!value || typeof value !== "object") return;
		const node = value as Record<string, unknown>;
		expect(Array.isArray(node.items)).toBe(false);
		if (
			typeof node.description === "string" &&
			node.description.startsWith("WGS84 [longitude")
		) {
			positions++;
			expect(node).toMatchObject({
				type: "array",
				minItems: 2,
				maxItems: 2,
				items: { type: "number" },
			});
		}
		for (const child of Object.values(node)) inspect(child);
	}
	for (const tool of tools) inspect(tool.inputSchema);
	expect(positions).toBeGreaterThan(0);
	for (const coordinates of [[181, 0], [0, 91], [0], [0, 0, 0]]) {
		const result = await client.callTool({
			name: "buffer-aoi",
			arguments: {
				geometry: { type: "Point", coordinates },
				distanceMeters: 100,
			},
		});
		expect(result.isError).toBe(true);
	}
	expect(requests).toHaveLength(0);
});
test("tools/list exposes 19 tools, with creation and processing as non-idempotent writes", async () => {
	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name).sort()).toEqual(
		calls.map((c) => c[0]).sort(),
	);
	for (const t of tools) {
		expect(t.outputSchema?.type).toBe("object");
		expect(t.title).toBeTruthy();
		const write = ["start-processing", "create-project"].includes(t.name);
		expect(t.annotations?.readOnlyHint).toBe(!write);
		expect(t.annotations?.idempotentHint).toBe(!write);
		expect(t.annotations?.destructiveHint).toBe(t.name === "start-processing");
	}
});
test("MCP exposes Lab models and estimates them without additional activation tools", async () => {
	const model = {
		id,
		name: "Pools",
		kind: "lab",
		blocks: [{ name: "pools", price: 2.5 }],
	};
	responseOverride = (url) =>
		url.pathname === "/rest/models/lab"
			? Response.json([
					{ workflowDef: model, activeOnAccount: false, activeProjectIds: [] },
				])
			: undefined;
	const models = await client.callTool({ name: "list-models", arguments: {} });
	expect(models.isError).not.toBe(true);
	expect(models.structuredContent).toEqual({ models: [model] });
	const cost = await client.callTool({
		name: "calculate-cost",
		arguments: { wdName: "Pools", areaSqKm: 1 },
	});
	expect(cost.isError).not.toBe(true);
	expect(
		requests.filter((r) => r.method !== "GET").map((r) => r.url.pathname),
	).toEqual(["/rest/processing/cost/details/v2"]);
});
for (const [name, args] of calls)
	test(`MCP call: ${name}`, async () => {
		const result = await client.callTool({ name, arguments: args });
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toBeDefined();
		const data = z
			.record(z.string(), z.unknown())
			.parse(result.structuredContent);
		if (name === "list-projects") {
			expect(JSON.stringify(data)).not.toContain("private@example.com");
			expect(requests[0]?.body).toMatchObject({
				filter: "Test",
				limit: 20,
				sortBy: "UPDATED",
			});
		}
		if (name === "create-project") {
			expect(requests).toHaveLength(1);
			expect(requests[0]?.method).toBe("POST");
			expect(requests[0]?.url.pathname).toBe("/rest/projects");
			expect(requests[0]?.body).toEqual({
				name: "Test project",
				description: "MCP test",
			});
			expect(new Headers(requests[0]?.headers).get("Authorization")).toBe(
				"Basic test-token",
			);
			expect(data).toMatchObject({
				id,
				name: "Test project",
				isDefault: false,
			});
			expect(JSON.stringify(data)).not.toContain("private@example.com");
		}
		if (name === "list-mosaics") {
			expect(requests[0]?.url.searchParams.getAll("tags")).toEqual([
				"one",
				"two",
			]);
			expect(JSON.stringify(data)).not.toContain("footprint");
		}
		if (name === "get-mosaic") {
			expect(data.geometry).toBeUndefined();
			expect(data.geometrySummary).toMatchObject({
				geometryIncluded: false,
				vertexCount: 5,
			});
			expect(data.areaM2).toBeGreaterThan(0);
		}
		if (name === "get-mosaic-status") {
			expect(data.ready).toBe(true);
			expect(data.images).toBeUndefined();
			expect(data.warnings).toHaveLength(1);
		}
		if (name === "get-processing-statistics") {
			expect(data.totalAreaM2).toBe(300);
			expect(data.totalAreaKm2).toBe(0.0003);
		}
		if (name === "search-imagery-catalog") {
			expect(requests[0]?.body).toMatchObject({
				aoi: geometry,
				acquisitionDateFrom: "2026-10-01T00:00:00.000Z",
				acquisitionDateTo: "2026-10-14T23:59:59.999Z",
				returnErrors: true,
			});
			expect(data.providerErrors).toHaveLength(1);
		}
		if (name === "get-image-metadata")
			expect(requests[0]?.url.pathname).toContain("opaque%2Fimage%3A1");
		if (name === "buffer-aoi") expect(data.areaM2).toBeGreaterThan(1_300_000);
		if (name === "calculate-cost")
			expect(data).toEqual({
				cost: 10,
				dataCost: 3,
				processingCost: 7,
				unit: "credits",
				preliminary: false,
			});
	});
test("project creation accepts backend length limits and an omitted description", async () => {
	for (const args of [
		{ name: "New project" },
		{ name: "x".repeat(128), description: "x".repeat(1024) },
	]) {
		const result = await client.callTool({
			name: "create-project",
			arguments: args,
		});
		expect(result.isError).not.toBe(true);
		expect(requests.at(-1)?.body).toEqual(args);
	}
});
test("project creation rejects invalid input before making any REST request", async () => {
	for (const args of [
		{},
		{ name: "   " },
		{ name: "x".repeat(129) },
		{ name: "New", description: "x".repeat(1025) },
		{ name: "New", description: 123 },
		{ name: "New", ownerId: id },
	]) {
		const result = await client.callTool({
			name: "create-project",
			arguments: args,
		});
		expect(result.isError).toBe(true);
	}
	expect(requests).toHaveLength(0);
});
for (const failure of ["network", "server", "json", "schema"] as const)
	test(`project creation ${failure} failure reports unknown outcome without retrying`, async () => {
		responseOverride = () => {
			if (failure === "network") throw new Error("secret upstream details");
			if (failure === "server")
				return new Response("secret upstream details", { status: 500 });
			if (failure === "json") return new Response("secret upstream details");
			return Response.json({ message: "secret upstream details" });
		};
		const result = await client.callTool({
			name: "create-project",
			arguments: { name: "New" },
		});
		expect(result.isError).toBe(true);
		expect(requests).toHaveLength(1);
		expect(JSON.stringify(result.content)).toContain(
			"Project creation outcome is unknown",
		);
		expect(JSON.stringify(result.content)).toContain("list-projects");
		expect(JSON.stringify(result)).not.toContain("secret upstream");
	});
test("HTTP errors and malformed successful responses become isError without response body leakage", async () => {
	responseOverride = () =>
		new Response("secret upstream details", { status: 403 });
	const error = await client.callTool({
		name: "get-project",
		arguments: { projectId: id },
	});
	expect(error.isError).toBe(true);
	expect(JSON.stringify(error)).not.toContain("secret upstream");
	responseOverride = () => Response.json({ message: "failure despite 200" });
	expect(
		(await client.callTool({ name: "get-mosaic", arguments: { mosaicId: id } }))
			.isError,
	).toBe(true);
});
test("source conflict, numeric inference, unknown parameters and reversed dates fail before REST", async () => {
	const invalid: [string, Record<string, unknown>][] = [
		[
			"start-processing",
			{
				name: "Test",
				wdName: "Buildings",
				geometry,
				source: { type: "provider", name: "Mapbox" },
				dataProvider: { name: "Mapbox", zoom: 18 },
			},
		],
		["calculate-cost", { wdName: "Buildings", geometry, areaSqKm: 1 }],
		[
			"calculate-cost",
			{ wdName: "Buildings", geometry, inferenceParams: { threshold: 0.5 } },
		],
		["search-imagery-catalog", { geometry, dataProviders: ["does-not-exist"] }],
		[
			"search-imagery-catalog",
			{
				geometry,
				acquisitionDateFrom: "2026-10-15",
				acquisitionDateTo: "2026-10-14",
			},
		],
		["list-projects", { unknown: "not allowed" }],
	];
	for (const [name, args] of invalid)
		expect((await client.callTool({ name, arguments: args })).isError).toBe(
			true,
		);
	expect(requests).toHaveLength(0);
});
for (const params of [
	null,
	{
		sourceParams: {
			dataProvider: null,
			imagerySearch: {
				dataProvider: "arcgis_world_imagery",
				imageIds: ["1053325"],
				zoom: null,
			},
			myImagery: null,
			userDefined: null,
		},
		inferenceParams: null,
	},
	{
		sourceParams: { dataProvider: { providerName: "Mapbox", zoom: null } },
		inferenceParams: null,
	},
	{
		sourceParams: {
			dataProvider: null,
			myImagery: { mosaicId: id, imageIds: null },
		},
		inferenceParams: null,
	},
])
	test(`processing tools accept backend nullable fields: ${JSON.stringify(params)}`, async () => {
		const value = {
			...processing,
			cost: null,
			params,
			rating: { rating: 5, feedback: null },
		};
		responseOverride = (url) => {
			if (url.pathname.endsWith("/processings/v2/page"))
				return Response.json({ results: [value], count: 1, total: 1 });
			if (url.pathname.startsWith("/rest/processings"))
				return Response.json(value);
			return undefined;
		};
		for (const [name, args] of [
			["get-processing", { processingId: id }],
			["list-processings", { projectId: id }],
			[
				"start-processing",
				{
					name: "Test",
					wdName: "Buildings",
					geometry,
					source: { type: "provider", name: "Mapbox" },
				},
			],
		] as [string, Record<string, unknown>][]) {
			const result = await client.callTool({ name, arguments: args });
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent).toMatchObject(
				name === "list-processings"
					? {
							items: [
								{ id, cost: null, imagery: params?.sourceParams ?? null },
							],
						}
					: { id, cost: null, params, rating: { feedback: null } },
			);
		}
	});

test("catalog metadata uses provider routing and explicit zoom without losing other variants", async () => {
	responseOverride = () =>
		Response.json([
			{ ...image, zoom: 17 },
			{ ...image, zoom: 18 },
		]);
	for (const [dataProvider, expectedProvider] of [
		["CG_mosaic_2022", "cgmosaic"],
		["orbview_sv1", "orbview"],
		["roscosmos", "roscosmos"],
	]) {
		const result = await client.callTool({
			name: "get-image-metadata",
			arguments: { imageId: image.id, dataProvider, zoom: 18 },
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			id: image.id,
			zoom: 18,
			footprintSummary: expect.objectContaining({ geometryIncluded: false }),
			previews: [expect.objectContaining({ url: image.previews[0]?.url })],
		});
		expect(requests.at(-1)?.url.pathname).toBe(
			`/rest/catalog/${encodeURIComponent(image.id)}`,
		);
		expect(requests.at(-1)?.url.searchParams.get("provider_name")).toBe(
			expectedProvider ?? null,
		);
	}
	const ambiguous = await client.callTool({
		name: "get-image-metadata",
		arguments: { imageId: image.id },
	});
	expect(ambiguous.isError).toBe(true);
	expect(JSON.stringify(ambiguous.content)).toContain("AMBIGUOUS_IMAGE");
	const missing = await client.callTool({
		name: "get-image-metadata",
		arguments: { imageId: image.id, zoom: 19 },
	});
	expect(missing.isError).toBe(true);
	expect(JSON.stringify(missing.content)).toContain("NOT_FOUND");
});

test("ArcGIS metadata explains unsupported lookup without calling the backend", async () => {
	for (const zoom of [undefined, 17, 18]) {
		const result = await client.callTool({
			name: "get-image-metadata",
			arguments: {
				imageId: "601024",
				dataProvider: "arcgis_world_imagery",
				...(zoom === undefined ? {} : { zoom }),
			},
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("UNSUPPORTED_OPERATION");
		expect(JSON.stringify(result.content)).toContain("search-imagery-catalog");
		expect(JSON.stringify(result.content)).not.toContain("NOT_FOUND");
	}
	expect(requests).toHaveLength(0);
	const listed = await client.listTools();
	expect(
		listed.tools.find((tool) => tool.name === "get-image-metadata")
			?.description,
	).toContain("does not support lookup by ID");
});

test("Maxar metadata remains explicitly available on its legacy endpoint", async () => {
	const result = await client.callTool({
		name: "get-image-metadata",
		arguments: { imageId: image.id, dataProvider: "maxar" },
	});
	expect(result.isError).not.toBe(true);
	expect(requests[0]?.url.pathname).toBe(
		`/rest/catalog/meta/${encodeURIComponent(image.id)}`,
	);
});

test("statistics preserve empty groups with null geometryType alongside measured groups", async () => {
	responseOverride = () =>
		Response.json({
			...statistics,
			groups: [
				...statistics.groups,
				{
					key: "empty",
					geometryType: null,
					count: 0,
					area: null,
					length: null,
					classes: null,
					displayName: "Empty buildings",
					color: "#112233",
					metric: "area",
					order: 2,
				},
			],
		});
	const result = await client.callTool({
		name: "get-processing-statistics",
		arguments: { processingId: id },
	});
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toMatchObject({
		status: "READY",
		totalCount: 2,
		groups: [
			{ key: "buildings", geometryType: "POLYGON", count: 2, areaM2: 300 },
			{
				key: "empty",
				geometryType: null,
				count: 0,
				areaM2: null,
				areaKm2: null,
				lengthM: null,
				lengthKm: null,
				classes: [],
				displayName: "Empty buildings",
				color: "#112233",
				metric: "area",
				order: 2,
			},
		],
	});
});
test("statistics reject invalid geometryType values", async () => {
	responseOverride = () =>
		Response.json({
			...statistics,
			groups: statistics.groups.map((group) => ({
				...group,
				geometryType: 123,
			})),
		});
	const result = await client.callTool({
		name: "get-processing-statistics",
		arguments: { processingId: id },
	});
	expect(result.isError).toBe(true);
	expect(result.content).toEqual([
		{
			type: "text",
			text: JSON.stringify({
				code: "INVALID_RESPONSE",
				message: "Mapflow API returned an unexpected response shape",
			}),
		},
	]);
});
test("COMPUTING and READY with zero remain distinct", async () => {
	for (const status of ["COMPUTING", "READY", "FAILED"]) {
		responseOverride = () =>
			Response.json({
				processingId: id,
				status,
				isDefault: true,
				wdName: "Buildings",
				totalCount: 0,
				totalArea: null,
				aoiArea: 1,
				groups: [],
			});
		const result = await client.callTool({
			name: "get-processing-statistics",
			arguments: { processingId: id },
		});
		expect(result.structuredContent).toMatchObject({
			status,
			totalCount: 0,
			totalAreaM2: null,
		});
	}
});

test("catalog excludes inactive providers and preserves real selected-provider errors", async () => {
	const irrelevant = {
		providerName: "SkyWatch",
		message: "Invalid request: productTypes or dataProviders are incorrect",
	};
	const selected = { providerName: "ORBVIEW", message: irrelevant.message };
	const outage = { providerName: "SkyWatch", message: "upstream timeout" };
	responseOverride = () =>
		Response.json({
			images: [image],
			total: 120,
			errors: [irrelevant, selected, outage],
		});
	const result = await client.callTool({
		name: "search-imagery-catalog",
		arguments: { geometry, dataProviders: ["orbview_sv1"] },
	});
	expect(result.structuredContent).toMatchObject({
		hasNext: true,
		total: 120,
		providerErrors: [selected, outage],
		items: [
			{
				footprintSummary: expect.objectContaining({ geometryIncluded: false }),
				previews: [expect.objectContaining({ url: image.previews[0]?.url })],
			},
		],
	});
	await client.callTool({
		name: "search-imagery-catalog",
		arguments: { geometry },
	});
	expect(JSON.stringify(requests.at(-1)?.body)).not.toContain("skywatch");
	const before = requests.length;
	for (const provider of [
		"skywatch",
		"skywatch_spot",
		"skywatch_pleiades",
		"skywatch_pleiades_neo",
	]) {
		const rejected = await client.callTool({
			name: "search-imagery-catalog",
			arguments: { geometry, dataProviders: [provider] },
		});
		expect(rejected.isError).toBe(true);
	}
	expect(requests).toHaveLength(before);
});

test("missing metadata mentions zoom only when it was provided", async () => {
	responseOverride = () => Response.json([]);
	for (const args of [
		{ imageId: "missing" },
		{ imageId: "missing", zoom: 18 },
	]) {
		const result = await client.callTool({
			name: "get-image-metadata",
			arguments: args,
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content).includes("zoom")).toBe(
			"zoom" in args,
		);
	}
});

for (const variant of ["current", "original"]) {
	test(`GeoJSON ${variant} accepts the backend file media type`, async () => {
		responseOverride = (url) => {
			if (url.pathname.endsWith("/v2")) return Response.json(processing);
			const accept = new Headers(requests.at(-1)?.headers).get("Accept");
			if (accept !== "application/octet-stream")
				return new Response(null, { status: 406 });
			return new Response(
				JSON.stringify({ type: "FeatureCollection", features: [] }),
				{
					headers: { "Content-Type": "application/octet-stream" },
				},
			);
		};
		const result = await client.callTool({
			name: "get-processing-result",
			arguments: { processingId: id, variant },
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			format: "geojson",
			variant,
		});
		expect(new Headers(requests[0]?.headers).get("Accept")).toBe(
			"application/json",
		);
	});
}

test("GeoJSON result defaults to a resource without exposing internal layer URLs", async () => {
	responseOverride = (u) =>
		u.pathname.endsWith("/v2")
			? Response.json({
					...processing,
					vectorLayer: { tileUrl: "https://private.example/vector" },
					rasterLayer: { tileUrl: "https://private.example/raster" },
					resultRasterLayer: { tileUrl: "https://private.example/result" },
				})
			: undefined;
	const status = await client.callTool({
		name: "get-processing",
		arguments: { processingId: id },
	});
	expect(JSON.stringify(status)).not.toContain("private.example");
	const result = await client.callTool({
		name: "get-processing-result",
		arguments: { processingId: id, variant: "original" },
	});
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toMatchObject({
		delivery: "resource",
		warnings: [],
		fileName: `${id}-original.geojson`,
		format: "geojson",
	});
	expect(result.structuredContent).not.toHaveProperty("text");
	expect(result.content).toContainEqual({
		type: "resource",
		resource: {
			uri: `mapflow://processings/${id}/result/original.geojson`,
			mimeType: "application/geo+json",
			text: JSON.stringify({ type: "FeatureCollection", features: [] }),
		},
	});
	expect(requests.at(-1)?.url.pathname).toBe(
		`/rest/processings/${id}/result/original`,
	);
	expect(requests.at(-1)?.headers).toMatchObject({
		Authorization: "Basic test-token",
	});
});

for (const status of [403, 404])
	test(`GeoJSON download cannot bypass processing access (${status})`, async () => {
		responseOverride = () => new Response("denied", { status });
		const result = await client.callTool({
			name: "get-processing-result",
			arguments: { processingId: id },
		});
		expect(result.isError).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url.pathname).toBe(`/rest/processings/${id}/v2`);
	});

test("GeoJSON download rejects unfinished processings and aoiId", async () => {
	responseOverride = () =>
		Response.json({ ...processing, status: "IN_PROGRESS" });
	const result = await client.callTool({
		name: "get-processing-result",
		arguments: { processingId: id },
	});
	expect(JSON.stringify(result.content)).toContain("RESULT_NOT_READY");
	expect(requests).toHaveLength(1);
	const rejected = await client.callTool({
		name: "get-processing-result",
		arguments: { processingId: id, aoiId: id },
	});
	expect(rejected.isError).toBe(true);
	expect(requests).toHaveLength(1);
});

test("GeoJSON rejects invalid JSON and download permission failures", async () => {
	for (const response of [
		new Response("not json"),
		Response.json({ type: "FeatureCollection" }),
		new Response("denied", { status: 403 }),
	]) {
		responseOverride = (u) =>
			u.pathname.endsWith("/result") ? response : undefined;
		const result = await client.callTool({
			name: "get-processing-result",
			arguments: { processingId: id },
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).not.toContain('"type":"resource"');
	}
});

test("GeoJSON cancels oversized chunked streams without trusting Content-Length", async () => {
	let cancelled = false;
	responseOverride = (u) =>
		u.pathname.endsWith("/result")
			? new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(1024 * 1024));
						},
						cancel() {
							cancelled = true;
						},
					}),
					{ headers: { "Content-Length": "1" } },
				)
			: undefined;
	const result = await client.callTool({
		name: "get-processing-result",
		arguments: { processingId: id },
	});
	expect(JSON.stringify(result.content)).toContain("RESULT_TOO_LARGE");
	expect(cancelled).toBe(true);
});

test("cached boundary feeds catalog, cost and launch without leaking coordinates", async () => {
	const boundary = await client.callTool({
		name: "get-geoboundary",
		arguments: { query: "Test" },
	});
	const geometryId = (boundary.structuredContent as Record<string, unknown>)
		?.geometryId;
	expect(typeof geometryId).toBe("string");
	expect(
		(boundary.structuredContent as Record<string, unknown>)?.geometry,
	).toBeUndefined();
	expect(JSON.stringify(boundary.content)).not.toContain("coordinates");
	for (const [name, args] of calls.filter(([name]) =>
		["search-imagery-catalog", "calculate-cost", "start-processing"].includes(
			name,
		),
	)) {
		const { geometry: _, ...rest } = args;
		const result = await client.callTool({
			name,
			arguments: { ...rest, geometryId },
		});
		expect(result.isError).not.toBe(true);
	}
	for (const path of [
		"/rest/catalog/meta",
		"/rest/processing/cost/details/v2",
		"/rest/processings/v2",
	]) {
		const request = requests.find((r) => r.url.pathname === path);
		expect(request?.body).toMatchObject(
			path.includes("catalog") ? { aoi: geometry } : { geometry },
		);
		expect(request?.body).not.toHaveProperty("geometryId");
	}
});

test("buffer creates a new ID and optional GeoJSON without mutating the original", async () => {
	const boundary = await client.callTool({
		name: "get-geoboundary",
		arguments: { query: "Test", includeGeometry: true, maxOutputBytes: 32768 },
	});
	const geometryId = (boundary.structuredContent as Record<string, unknown>)
		?.geometryId;
	expect(
		(boundary.structuredContent as Record<string, unknown>)?.geometry,
	).toEqual(geometry);
	const buffered = await client.callTool({
		name: "buffer-aoi",
		arguments: {
			geometryId,
			distanceMeters: 100,
			includeGeometry: true,
			maxOutputBytes: 32768,
		},
	});
	expect(buffered.isError).not.toBe(true);
	expect(
		(buffered.structuredContent as Record<string, unknown>)?.geometryId,
	).not.toBe(geometryId);
	expect(
		(buffered.structuredContent as Record<string, unknown>)?.geometry,
	).not.toEqual(geometry);
	await client.callTool({
		name: "search-imagery-catalog",
		arguments: { geometryId },
	});
	expect(requests.at(-1)?.body).toMatchObject({ aoi: geometry });
});

test("invalid references and ambiguous geometry inputs never reach the API", async () => {
	for (const [name, args] of calls.filter(([name]) =>
		[
			"search-imagery-catalog",
			"calculate-cost",
			"start-processing",
			"buffer-aoi",
		].includes(name),
	)) {
		const { geometry: _, ...rest } = args;
		const expired = await client.callTool({
			name,
			arguments: { ...rest, geometryId: id },
		});
		expect(expired.isError).toBe(true);
		expect(JSON.stringify(expired.content)).toContain("GEOMETRY_EXPIRED");
		const ambiguous = await client.callTool({
			name,
			arguments: { ...args, geometryId: id },
		});
		expect(ambiguous.isError).toBe(true);
	}
	expect(requests).toHaveLength(0);
});

test("reference inputs retain original cross-field validation", async () => {
	const boundary = await client.callTool({
		name: "get-geoboundary",
		arguments: { query: "Test" },
	});
	const geometryId = (boundary.structuredContent as Record<string, unknown>)
		?.geometryId;
	for (const [name, args] of [
		["search-imagery-catalog", { minResolution: 2, maxResolution: 1 }],
		["start-processing", { name: "Test", wdName: "Buildings" }],
		["calculate-cost", { wdName: "Buildings", areaSqKm: 1 }],
		[
			"calculate-cost",
			{
				wdName: "Buildings",
				source: { type: "provider", name: "Mapbox" },
				dataProvider: { name: "Mapbox", zoom: 18 },
			},
		],
	] as const) {
		const result = await client.callTool({
			name,
			arguments: { ...args, geometryId },
		});
		expect(result.isError).toBe(true);
	}
	expect(requests).toHaveLength(0);
});

test("every geometry tool applies summary, simplified, full and legacy budget rules", async () => {
	const names = [
		"get-geoboundary",
		"buffer-aoi",
		"get-mosaic",
		"search-imagery-catalog",
		"get-image-metadata",
	];
	for (const [name, args] of calls.filter(([name]) => names.includes(name))) {
		for (const options of [
			{},
			{ geometryMode: "full" },
			{ includeGeometry: true },
		]) {
			const result = await client.callTool({
				name,
				arguments: { ...args, ...options },
			});
			expect(result.isError).not.toBe(true);
			expect(JSON.stringify(result)).not.toContain('"coordinates"');
			if ("geometryMode" in options || "includeGeometry" in options)
				expect(JSON.stringify(result)).toContain("maxOutputBytes");
		}
		for (const options of [
			{ geometryMode: "simplified", maxVertices: 20 },
			{ geometryMode: "full", maxOutputBytes: 32768 },
			{ includeGeometry: true, maxOutputBytes: 32768 },
		]) {
			const result = await client.callTool({
				name,
				arguments: { ...args, ...options },
			});
			expect(result.isError).not.toBe(true);
			expect(JSON.stringify(result.structuredContent)).toContain(
				'"coordinates"',
			);
			expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
				32768,
			);
		}
		for (const options of [
			{ geometryMode: "full", maxOutputBytes: 262145 },
			{ geometryMode: "summary", includeGeometry: true },
			{ geometryMode: "simplified", maxVertices: 1001 },
		]) {
			const result = await client.callTool({
				name,
				arguments: { ...args, ...options },
			});
			expect(result.isError).toBe(true);
		}
	}
});

test("project output omits workflow definitions and directs model lookup", async () => {
	responseOverride = () =>
		Response.json({
			id,
			name: "Compact",
			processingCounts: { OK: 3 },
			workflowDefs: [
				{
					name: "Large workflow",
					blocks: [{ name: "Hidden block", price: 42 }],
				},
			],
		});
	const result = await client.callTool({
		name: "get-project",
		arguments: { projectId: "default" },
	});
	expect(result.isError).not.toBe(true);
	expect(JSON.stringify(result)).not.toContain("workflowDefs");
	expect(JSON.stringify(result)).not.toContain("Hidden block");
	expect(result.structuredContent).toMatchObject({
		id,
		name: "Compact",
		processingCounts: { OK: 3 },
	});
	const { tools } = await client.listTools();
	expect(tools.find((t) => t.name === "get-project")?.description).toContain(
		"list-models",
	);
	const start = tools.find((t) => t.name === "start-processing");
	expect(start?.description).toContain("Charges account credits");
	expect(start?.description).not.toContain("ONLY");
});

test("missing processing data gives recovery guidance without masking authorization errors", async () => {
	for (const status of [404, 403, 401]) {
		responseOverride = () => new Response("", { status });
		for (const name of [
			"get-processing",
			"get-processing-statistics",
			"get-processing-result",
		]) {
			const result = await client.callTool({
				name,
				arguments: { processingId: id },
			});
			expect(result.isError).toBe(true);
			const content = JSON.stringify(result.content);
			expect(content).toContain(
				status === 404 ? "NOT_FOUND" : `HTTP_${status}`,
			);
			if (status === 404) {
				expect(content).toContain("list-processings");
				expect(content).toContain("not accessible");
			}
		}
	}
});

test("text-only clients explicitly request complete GeoJSON with a truncation warning", async () => {
	const result = await client.callTool({
		name: "get-processing-result",
		arguments: { processingId: id, delivery: "text" },
	});
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toMatchObject({
		delivery: "text",
		warnings: [expect.stringContaining("may be truncated by the client")],
	});
	const blocks = result.content as { type: string; text?: string }[];
	expect(blocks.every((b) => b.type === "text")).toBe(true);
	const file = blocks.find(
		(b) => b.text && JSON.parse(b.text).type === "FeatureCollection",
	);
	expect(file).toBeDefined();
	expect(JSON.parse(file?.text ?? "null")).toEqual({
		type: "FeatureCollection",
		features: [],
	});
});
test("large GeoJSON needs an explicit budget and returns a warning without truncation", async () => {
	const geojson = {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				geometry: null,
				properties: { value: "x".repeat(70000) },
			},
		],
	};
	const text = JSON.stringify(geojson);
	responseOverride = (u) =>
		u.pathname.endsWith("/v2") ? Response.json(processing) : new Response(text);
	const blocked = await client.callTool({
		name: "get-processing-result",
		arguments: { processingId: id },
	});
	expect(blocked.isError).toBe(true);
	expect(JSON.stringify(blocked.content)).toContain("RESULT_TOO_LARGE");
	const allowed = await client.callTool({
		name: "get-processing-result",
		arguments: { processingId: id, maxResultBytes: 100000 },
	});
	expect(allowed.isError).not.toBe(true);
	expect(allowed.content).toContainEqual({
		type: "resource",
		resource: {
			uri: `mapflow://processings/${id}/result/current.geojson`,
			mimeType: "application/geo+json",
			text,
		},
	});
	expect(allowed.structuredContent).toMatchObject({
		warnings: [expect.stringContaining("Large GeoJSON")],
	});
});
