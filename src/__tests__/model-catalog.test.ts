import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createMapflowClient } from "../mapflow-client.js";
import {
	apiFixture,
	geometry,
	id,
	mosaicStatus,
	project,
	user,
} from "./fixtures.js";

const labId = "550e8400-e29b-41d4-a716-446655440001";
const labModel = {
	id: labId,
	name: "Swimming pools",
	kind: "lab" as const,
	description: "Detect swimming pools",
	pricePerSqKm: 2.5,
	blocks: [{ name: "pools", optional: false, price: 2.5 }],
};
const entry = {
	workflowDef: labModel,
	activeOnAccount: false,
	activeProjectIds: [],
};
const launch = {
	name: "Lab test",
	wdName: labModel.name,
	geometry,
	source: { type: "provider" as const, name: "Mapbox", zoom: 18 },
};
type Request = { path: string; method: string; body: Record<string, unknown> };
const originalFetch = globalThis.fetch;
let calls: Request[];
let catalog: unknown;
let account: unknown;
let linked: { id: string }[];
let properties: Record<string, unknown> | null;
let override:
	| ((request: Request) => Response | Promise<Response> | undefined)
	| undefined;
beforeEach(() => {
	calls = [];
	catalog = [entry];
	account = user;
	linked = [];
	properties = null;
	override = undefined;
	globalThis.fetch = mock(async (url: URL, init?: RequestInit) => {
		const request = {
			path: url.pathname,
			method: init?.method ?? "GET",
			body: init?.body ? JSON.parse(String(init.body)) : {},
		};
		calls.push(request);
		const response = await override?.(request);
		if (response) return response;
		if (request.path === "/rest/user/status") return Response.json(account);
		if (request.path === "/rest/models/lab") return Response.json(catalog);
		if (request.path.startsWith(`/rest/projects/${id}/models/`)) {
			const modelId = request.path.split("/").at(-1) as string;
			if (!linked.some((m) => m.id === modelId)) linked.push({ id: modelId });
			return Response.json("OK");
		}
		if (request.path.startsWith("/rest/projects/")) {
			if (request.method === "PUT")
				properties = request.body.displayProperties as Record<string, unknown>;
			return Response.json({
				...project,
				workflowDefs: linked,
				displayProperties: properties,
			});
		}
		return Response.json(apiFixture(url));
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const writes = () => calls.filter((call) => call.method !== "GET");

test("fetches both catalogs concurrently, deduplicates by ID and preserves model details", async () => {
	let releaseStatus: (() => void) | undefined;
	const waiting = new Promise<void>((resolve) => {
		releaseStatus = resolve;
	});
	account = {
		...user,
		models: [...user.models, { ...labModel, pricePerSqKm: 99 }],
	};
	override = async ({ path }) => {
		if (path === "/rest/models/lab") {
			releaseStatus?.();
			return Response.json(catalog);
		}
		await waiting;
		return Response.json(account);
	};
	const models = await createMapflowClient("token").getModels();
	expect(models).toEqual([...user.models, labModel]);
	expect(writes()).toEqual([]);
});

test("empty Lab catalog retains account models", async () => {
	catalog = [];
	expect(await createMapflowClient("token").getModels()).toEqual(user.models);
});

test("fresh catalog removes archived Lab entries despite cached account status", async () => {
	account = { ...user, models: [...user.models, labModel] };
	const client = createMapflowClient("token");
	expect(await client.getModels()).toHaveLength(2);
	catalog = [];
	expect(await client.getModels()).toEqual(user.models);
	expect(calls.filter((c) => c.path === "/rest/user/status")).toHaveLength(1);
});

for (const invalid of [{}, [{ ...entry, workflowDef: { name: "Bad" } }]])
	test(`malformed Lab catalog fails instead of returning incomplete models: ${JSON.stringify(invalid)}`, async () => {
		catalog = invalid;
		await expect(
			createMapflowClient("token").getModels(),
		).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
	});

test("catalog outage stops both discovery and paid start", async () => {
	override = ({ path }) =>
		path === "/rest/models/lab"
			? new Response(null, { status: 503 })
			: undefined;
	const client = createMapflowClient("token");
	await expect(client.getModels()).rejects.toMatchObject({ code: "HTTP_503" });
	await expect(client.createProcessing(launch)).rejects.toMatchObject({
		code: "HTTP_503",
	});
	expect(writes()).toEqual([]);
});

test("cost uses the Lab model ID without activating or linking it", async () => {
	const cost = await createMapflowClient("token").calculateCost({
		wdName: labModel.name,
		geometry,
		source: launch.source,
	});
	expect(cost.cost).toBe(10);
	expect(writes()).toHaveLength(1);
	expect(writes()[0]).toMatchObject({
		path: "/rest/processing/cost/details/v2",
		body: { wdId: labId },
	});
});

test("Lab start links selected project before charging and preserves explicit model selection", async () => {
	properties = { models: [id], color: "blue" };
	await createMapflowClient("token").createProcessing({
		...launch,
		projectId: id,
	});
	expect(writes().map((c) => [c.method, c.path])).toEqual([
		["POST", `/rest/projects/${id}/models/${labId}`],
		["PUT", `/rest/projects/${id}`],
		["POST", "/rest/processings/v2"],
	]);
	expect(writes()[1]?.body).toEqual({
		displayProperties: { models: [id, labId], color: "blue" },
	});
	expect(writes()[2]?.body.projectId).toBe(id);
	expect(calls.some((c) => c.path.endsWith("/account"))).toBe(false);
});

test("omitted project resolves default and uses that same UUID for link and start", async () => {
	await createMapflowClient("token").createProcessing(launch);
	expect(calls.some((c) => c.path === "/rest/projects/default")).toBe(true);
	expect(writes().map((c) => c.path)).toEqual([
		`/rest/projects/${id}/models/${labId}`,
		"/rest/processings/v2",
	]);
	expect(writes()[1]?.body.projectId).toBe(id);
});

for (const selection of [
	null,
	{ models: "all" },
	{ models: [labId], color: "blue" },
])
	test(`already visible Lab model needs no project writes: ${JSON.stringify(selection)}`, async () => {
		linked = [{ id: labId }];
		properties = selection;
		await createMapflowClient("token").createProcessing({
			...launch,
			projectId: id,
		});
		expect(writes().map((c) => c.path)).toEqual(["/rest/processings/v2"]);
	});

test("linked but hidden Lab model is added to web selection without relinking", async () => {
	linked = [{ id: labId }];
	properties = { models: [] };
	await createMapflowClient("token").createProcessing({
		...launch,
		projectId: id,
	});
	expect(writes().map((c) => c.method)).toEqual(["PUT", "POST"]);
	expect(properties).toEqual({ models: [labId] });
});

test("ordinary models do not change project settings", async () => {
	await createMapflowClient("token").createProcessing({
		...launch,
		wdName: "Buildings",
		projectId: id,
	});
	expect(calls.some((c) => c.path.startsWith("/rest/projects/"))).toBe(false);
	expect(writes().map((c) => c.path)).toEqual(["/rest/processings/v2"]);
});

for (const failure of ["forbidden", "invalid-ack", "network", "selection"])
	test(`preparation failure prevents charge and allows later recovery: ${failure}`, async () => {
		properties = { models: [] };
		override = ({ path, method }) => {
			if (path.endsWith(`/models/${labId}`)) {
				if (failure === "forbidden") return new Response(null, { status: 403 });
				if (failure === "invalid-ack") return Response.json({ error: "no" });
				if (failure === "network") throw new Error("timeout");
			}
			if (failure === "selection" && method === "PUT")
				return new Response(null, { status: 403 });
			return undefined;
		};
		const client = createMapflowClient("token");
		await expect(
			client.createProcessing({ ...launch, projectId: id }),
		).rejects.toThrow();
		expect(calls.some((c) => c.path === "/rest/processings/v2")).toBe(false);
		override = undefined;
		await client.createProcessing({ ...launch, projectId: id });
		expect(calls.filter((c) => c.path === "/rest/processings/v2")).toHaveLength(
			1,
		);
	});

test("invalid provider and unready mosaic fail before project mutations", async () => {
	const client = createMapflowClient("token");
	await expect(
		client.createProcessing({
			...launch,
			source: { type: "provider", name: "Missing" },
		}),
	).rejects.toMatchObject({ code: "INVALID_PROVIDER" });
	override = ({ path }) =>
		path === `/rest/rasters/mosaic/${id}/status`
			? Response.json({ ...mosaicStatus, pending_images: 1 })
			: undefined;
	await expect(
		client.createProcessing({
			...launch,
			source: { type: "myImagery", mosaicId: id },
		}),
	).rejects.toMatchObject({ code: "MOSAIC_NOT_READY" });
	expect(writes()).toEqual([]);
});

test("successful HTTP response that ignores the model selection still prevents charge", async () => {
	properties = { models: [] };
	override = ({ method }) =>
		method === "PUT"
			? Response.json({
					...project,
					workflowDefs: linked,
					displayProperties: properties,
				})
			: undefined;
	await expect(
		createMapflowClient("token").createProcessing({ ...launch, projectId: id }),
	).rejects.toThrow("Processing was not started");
	expect(calls.some((c) => c.path === "/rest/processings/v2")).toBe(false);
});

test("wrong project ID in a response prevents linking or charging", async () => {
	override = ({ path }) =>
		path === `/rest/projects/${id}`
			? Response.json({ ...project, id: labId, workflowDefs: [] })
			: undefined;
	await expect(
		createMapflowClient("token").createProcessing({ ...launch, projectId: id }),
	).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
	expect(writes()).toEqual([]);
});

test("duplicate names across different IDs cannot silently select the wrong model", async () => {
	account = { ...user, models: [{ id, name: labModel.name }] };
	await expect(
		createMapflowClient("token").createProcessing(launch),
	).rejects.toMatchObject({ code: "AMBIGUOUS_MODEL" });
	expect(writes()).toEqual([]);
});

test("concurrent starts preserve both model additions in one project's web selection", async () => {
	const other = {
		...labModel,
		id: "550e8400-e29b-41d4-a716-446655440002",
		name: "Solar panels",
	};
	catalog = [entry, { ...entry, workflowDef: other }];
	properties = { models: [id], color: "blue" };
	const client = createMapflowClient("token");
	await Promise.all([
		client.createProcessing({ ...launch, projectId: id }),
		createMapflowClient("another-token").createProcessing({
			...launch,
			projectId: id,
			wdName: other.name,
		}),
	]);
	expect(properties).toEqual({ models: [id, labId, other.id], color: "blue" });
});

test("failed paid launch is never retried and does not undo an attached model", async () => {
	override = ({ path }) => {
		if (path === "/rest/processings/v2") throw new Error("timeout");
		return undefined;
	};
	await expect(
		createMapflowClient("token").createProcessing(launch),
	).rejects.toThrow("outcome is unknown");
	expect(calls.filter((c) => c.path === "/rest/processings/v2")).toHaveLength(
		1,
	);
	expect(linked).toEqual([{ id: labId }]);
});
