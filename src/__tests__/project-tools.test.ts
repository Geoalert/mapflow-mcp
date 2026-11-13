import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createMapflowClient } from "../mapflow-client.js";
import { createWebLinks } from "../web-links.js";
import { id, project } from "./fixtures.js";

const originalFetch = globalThis.fetch;
let requests: { method: string; path: string; body: unknown }[];
let response: (method: string, body: Record<string, unknown>) => Response;
beforeEach(() => {
	requests = [];
	response = (method, body) =>
		method === "DELETE"
			? Response.json("OK")
			: Response.json({ ...project, isDefault: false, ...body });
	globalThis.fetch = mock(async (url: URL, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		requests.push({ method, path: url.pathname, body });
		return response(method, body);
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("web links use the configured environment and encode processing selection", () => {
	for (const origin of [
		"https://duty.mapflow.ai",
		"https://custom.example.test/",
	]) {
		const links = createWebLinks(origin);
		expect(links.project(id)).toBe(`${new URL(origin).origin}/projects/${id}`);
		expect(links.processing("a&b", id)).toBe(
			`${new URL(origin).origin}/projects/${id}?processing=a%26b`,
		);
		expect(links.processing(id)).toBeNull();
	}
});
for (const value of [
	"",
	"invalid",
	"javascript:alert(1)",
	"https://user:pass@example.com",
	"https://example.com/path",
	"https://example.com?x=1",
	"https://example.com#fragment",
])
	test(`invalid web configuration fails: ${value}`, () => {
		expect(() => createWebLinks(value)).toThrow("MAPFLOW_WEB_URL");
	});

for (const fields of [
	{ name: "Renamed" },
	{ description: "New description" },
	{ description: "" },
	{ name: "Renamed", description: "Both" },
])
	test(`update sends only requested fields: ${JSON.stringify(fields)}`, async () => {
		const result = await createMapflowClient("test").updateProject({
			projectId: id,
			...fields,
		});
		expect(result).toMatchObject(fields);
		expect(requests).toEqual([
			{ method: "PUT", path: `/rest/projects/${id}`, body: fields },
		]);
	});

for (const fields of [
	{},
	{ name: " " },
	{ name: "a".repeat(129) },
	{ description: "a".repeat(1025) },
	{ description: null },
	{ displayProperties: {} },
])
	test("invalid update never reaches backend", async () => {
		await expect(
			createMapflowClient("test").updateProject({
				projectId: id,
				...fields,
			} as Parameters<
				ReturnType<typeof createMapflowClient>["updateProject"]
			>[0]),
		).rejects.toThrow();
		expect(requests).toHaveLength(0);
	});

test("delete checks project then archives it with explicit acknowledgement", async () => {
	expect(
		await createMapflowClient("test").deleteProject({ projectId: id }),
	).toEqual({ projectId: id, name: project.name, archived: true });
	expect(requests.map((r) => r.method)).toEqual(["GET", "DELETE"]);
});
test("default project is never sent to DELETE", async () => {
	response = () => Response.json(project);
	await expect(
		createMapflowClient("test").deleteProject({ projectId: id }),
	).rejects.toMatchObject({ code: "DEFAULT_PROJECT" });
	expect(requests.map((r) => r.method)).toEqual(["GET"]);
});
for (const invalid of [
	{ ...project, isDefault: undefined },
	{ ...project, id: "550e8400-e29b-41d4-a716-446655440001", isDefault: false },
])
	test("unverified project identity/default state blocks deletion", async () => {
		response = () => Response.json(invalid);
		await expect(
			createMapflowClient("test").deleteProject({ projectId: id }),
		).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
		expect(requests.map((r) => r.method)).toEqual(["GET"]);
	});

for (const status of [403, 404])
	test(`backend authorization/not-found error is preserved: ${status}`, async () => {
		response = () => new Response(null, { status });
		const client = createMapflowClient("test");
		await expect(
			client.updateProject({ projectId: id, name: "New" }),
		).rejects.toMatchObject({ code: `HTTP_${status}` });
		await expect(client.deleteProject({ projectId: id })).rejects.toMatchObject(
			{ code: `HTTP_${status}` },
		);
		expect(requests.some((r) => r.method === "DELETE")).toBe(false);
	});

for (const operation of ["update", "delete"] as const)
	for (const failure of ["timeout", "server", "malformed"])
		test(`${operation} ${failure} reports unknown outcome without retry`, async () => {
			response = (method) => {
				if (method === "GET")
					return Response.json({ ...project, isDefault: false });
				if (failure === "timeout") throw new Error("network");
				if (failure === "server") return new Response(null, { status: 500 });
				return Response.json({ wrong: true });
			};
			const client = createMapflowClient("test");
			await expect(
				operation === "update"
					? client.updateProject({ projectId: id, name: "New" })
					: client.deleteProject({ projectId: id }),
			).rejects.toThrow("outcome is unknown");
			expect(requests.filter((r) => r.method !== "GET")).toHaveLength(1);
		});

test("backend ignoring requested update is not reported as success", async () => {
	response = () => Response.json(project);
	await expect(
		createMapflowClient("test").updateProject({
			projectId: id,
			name: "Changed",
		}),
	).rejects.toThrow("outcome is unknown");
});
