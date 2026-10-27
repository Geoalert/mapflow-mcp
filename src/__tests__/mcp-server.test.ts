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
test("tools/list exposes 18 tools, with creation and processing as non-idempotent writes", async () => {
	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name).sort()).toEqual(
		calls.map((c) => c[0]).sort(),
	);
	for (const t of tools) {
		expect(t.outputSchema?.type).toBe("object");
		const write = ["start-processing", "create-project"].includes(t.name);
		expect(t.annotations?.readOnlyHint).toBe(!write);
		expect(t.annotations?.idempotentHint).toBe(!write);
		expect(t.annotations?.destructiveHint).toBe(t.name === "start-processing");
	}
	expect(
		tools.some(
			(t) => t.name.includes("result") && !t.name.includes("statistics"),
		),
	).toBe(false);
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
			expect(data.geometry).toEqual(geometry);
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
		["arcgis_world_imagery", "cgmosaic"],
		["CG_mosaic_2022", "cgmosaic"],
		["orbview_sv1", "orbview"],
		["roscosmos", "roscosmos"],
		["skywatch_spot", "skywatch_spot"],
	]) {
		const result = await client.callTool({
			name: "get-image-metadata",
			arguments: { imageId: image.id, dataProvider, zoom: 18 },
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({ id: image.id, zoom: 18 });
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
