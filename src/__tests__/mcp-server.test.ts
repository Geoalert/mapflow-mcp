import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as z from "zod";
import { createMapflowClient } from "../mapflow-client.js";
import { createServer } from "../mcp-server.js";
import { apiFixture, geometry, id, user } from "./fixtures.js";

const originalFetch = globalThis.fetch;
let client: Client;
let server: ReturnType<typeof createServer>;
let requests: { url: URL; body: unknown; headers: RequestInit["headers"] }[];
let responseOverride: ((url: URL) => Response | undefined) | undefined;
beforeEach(async () => {
	requests = [];
	responseOverride = undefined;
	globalThis.fetch = mock(
		async (url: string | URL | Request, init?: RequestInit) => {
			const u = new URL(String(url));
			requests.push({
				url: u,
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
test("tools/list exposes exactly the 17 tools and output schemas, with only start as a write", async () => {
	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name).sort()).toEqual(
		calls.map((c) => c[0]).sort(),
	);
	for (const t of tools) {
		expect(t.outputSchema?.type).toBe("object");
		expect(t.annotations?.readOnlyHint).toBe(t.name !== "start-processing");
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
