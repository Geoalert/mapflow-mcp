import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
	checkManifest,
	InteractiveCatalog,
	interactiveTransport,
	JOINT_INSTRUCTIONS,
	type Manifest,
	ManifestError,
	readInteractiveConfig,
} from "../interactive.js";
import { createMapflowClient } from "../mapflow-client.js";
import { createServer } from "../mcp-server.js";
import { apiFixture } from "./fixtures.js";

const APP = "https://interactive.example.test";
// The list's item, which the test's fixture has.
const nth = <T>(items: readonly T[], i: number): T => {
	const item = items[i];
	if (item === undefined) throw new Error(`no item ${i}`);
	return item;
};
const PAGE = "ui://mapflow-interactive/card.html";
const hints = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
};
const fixture = () =>
	({
		version: "a1b2c3",
		server: { name: "mapflow-interactive", title: "Mapflow Interactive" },
		instructions: "Mapflow Interactive's workflow.",
		tools: [
			{
				name: "start-session",
				title: "Interactive: Start a session",
				description: "Starts a session: one task on one image.",
				inputSchema: {
					type: "object",
					properties: {
						image: { type: "string", description: "The image to work on" },
						copyQuery: {
							type: "object",
							properties: { session: { type: "string" } },
						},
					},
					required: ["image"],
				},
				annotations: hints,
				_meta: { ui: { resourceUri: PAGE } },
			},
			{
				name: "view",
				title: "Interactive: View the image",
				description: "A picture of the image or a region.",
				// Not in the parse's order of keys: it goes out as written.
				inputSchema: {
					properties: { sid: { maxLength: 40, type: "string" } },
					required: ["sid"],
					type: "object",
				},
				annotations: { ...hints, readOnlyHint: true },
			},
		],
		prompts: [
			{
				name: "find-objects",
				title: "Find objects on an image",
				description: "The workflow.",
				arguments: [{ name: "task", description: "What to find" }],
			},
		],
		resources: [
			{
				uri: PAGE,
				name: "session",
				mimeType: "text/html;profile=mcp-app",
				_meta: { ui: { prefersBorder: true } },
			},
		],
		attach: [
			{
				tool: "list-mosaics",
				_meta: { ui: { resourceUri: PAGE } },
				resultMeta: { "mapflow-interactive/widget": { tool: "list-mosaics" } },
			},
		],
		deprecated: [],
	}) as Manifest;

const originalFetch = globalThis.fetch;
type Seen = { url: URL; method: string; headers: Headers; body: unknown };
let seen: Seen[];
let answer: (
	url: URL,
	init?: RequestInit,
) => Response | Promise<Response> | undefined;
let manifestBody: unknown;
let client: Client;
const KEY = "a-shared-key-for-the-tests";
const config = { baseUrl: APP, key: KEY, refreshMs: 60_000, timeoutMs: 2_000 };
let reserved: Set<string>;

beforeEach(() => {
	seen = [];
	answer = () => undefined;
	manifestBody = fixture();
	globalThis.fetch = mock(
		async (url: string | URL | Request, init?: RequestInit) => {
			const u = new URL(String(url));
			seen.push({
				url: u,
				method: init?.method ?? "GET",
				headers: new Headers(init?.headers),
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			const keyed = ["/api/agent/v1/manifest", "/api/agent/v1/resources"];
			if (
				u.origin === APP &&
				keyed.includes(u.pathname) &&
				new Headers(init?.headers).get("x-interactive-key") !== KEY
			)
				return new Response("key", { status: 401 });
			const given = await answer(u, init);
			if (given) return given;
			if (u.origin === APP && u.pathname === "/api/agent/v1/manifest")
				return Response.json(manifestBody, { headers: { ETag: '"m1"' } });
			return Response.json(apiFixture(u));
		},
	) as unknown as typeof fetch;
	reserved = new Set(createServer({ allowEnvToken: false }).toolNames);
});
afterEach(async () => {
	await client?.close();
	globalThis.fetch = originalFetch;
});

async function connect(catalog?: InteractiveCatalog) {
	const api = createMapflowClient("test-token");
	const server = createServer({
		getClient: () => api,
		geometryOwner: "test-user",
		interactive: catalog,
		credentials: "test-token",
	});
	client = new Client({ name: "interactive-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(b);
	await client.connect(a);
	return client;
}

async function loaded() {
	const catalog = new InteractiveCatalog(config, reserved);
	await catalog.refresh();
	expect(catalog.manifest?.version).toBe("a1b2c3");
	return catalog;
}

test("off without MAPFLOW_INTERACTIVE_URL; an https address and its key otherwise", () => {
	expect(readInteractiveConfig({})).toBeUndefined();
	expect(
		readInteractiveConfig({
			MAPFLOW_INTERACTIVE_URL: `${APP}/`,
			MAPFLOW_INTERACTIVE_KEY: ` ${KEY} `,
		}),
	).toEqual({
		baseUrl: APP,
		key: KEY,
		refreshMs: 300_000,
		timeoutMs: 60_000,
	});
	expect(
		readInteractiveConfig({
			MAPFLOW_INTERACTIVE_URL: "http://localhost:8000",
			MAPFLOW_INTERACTIVE_KEY: KEY,
		})?.baseUrl,
	).toBe("http://localhost:8000");
	expect(() =>
		readInteractiveConfig({
			MAPFLOW_INTERACTIVE_URL: "http://interactive.example.test",
			MAPFLOW_INTERACTIVE_KEY: KEY,
		}),
	).toThrow("https");
	expect(() =>
		readInteractiveConfig({ MAPFLOW_INTERACTIVE_URL: `${APP}/` }),
	).toThrow("MAPFLOW_INTERACTIVE_KEY");
});

test("the manifest and the card's page are read with the key; a wrong key lists nothing", async () => {
	const catalog = await loaded();
	const reads = seen.filter((s) => s.url.pathname === "/api/agent/v1/manifest");
	expect(reads.map((s) => s.headers.get("x-interactive-key"))).toEqual([KEY]);
	const wrong = new InteractiveCatalog(
		{ ...config, key: "not-the-key" },
		reserved,
	);
	await wrong.refresh();
	expect(wrong.manifest).toBeUndefined();
	expect(catalog.manifest).toBeDefined();
});

test("a manifest is refused unless every tool is complete and none is the server's own", () => {
	expect(checkManifest(fixture(), reserved).tools).toHaveLength(2);
	const refused = (change: (m: Manifest) => void, previous?: Manifest) => {
		const m = fixture();
		change(m);
		return () => checkManifest(m, reserved, previous);
	};
	const named = (name: string) => (m: Manifest) => {
		nth(m.tools, 0).name = name;
	};
	expect(refused(named("list-mosaics"))).toThrow("name of this server's");
	expect(refused(named("list_mosaics"))).toThrow(ManifestError);
	expect(refused(named("Start_Session"))).toThrow(ManifestError);
	expect(refused(named("x".repeat(65)))).toThrow(ManifestError);
	expect(
		refused((m) => {
			const { openWorldHint: _, ...rest } = nth(m.tools, 0).annotations;
			nth(m.tools, 0).annotations =
				rest as Manifest["tools"][number]["annotations"];
		}),
	).toThrow(ManifestError);
	expect(
		refused((m) =>
			Object.assign(nth(m.tools, 0), { outputSchema: { type: "object" } }),
		),
	).toThrow(ManifestError);
	expect(
		refused((m) => {
			nth(m.tools, 1).title = "";
		}),
	).toThrow(ManifestError);
	expect(
		refused((m) => {
			nth(m.attach, 0).tool = "view";
		}),
	).toThrow("not a tool of this server's");
	// A tool goes only after a release that marked it as going.
	const before = fixture();
	expect(refused((m) => m.tools.pop(), before)).toThrow(
		"dropped without a release",
	);
	expect(
		refused((m) => m.tools.pop(), { ...before, deprecated: ["view"] }),
	).not.toThrow();
});

test("the catalog keeps the last good manifest and asks again by its ETag", async () => {
	const catalog = await loaded();
	answer = (u, init) =>
		u.pathname === "/api/agent/v1/manifest" &&
		new Headers(init?.headers).get("if-none-match") === '"m1"'
			? new Response(null, { status: 304 })
			: undefined;
	await catalog.refresh();
	expect(catalog.manifest?.version).toBe("a1b2c3");
	answer = () => Response.json({ ...fixture(), tools: [{ name: "broken" }] });
	await catalog.refresh();
	expect(catalog.manifest?.version).toBe("a1b2c3");
	answer = () => new Response("down", { status: 503 });
	await catalog.refresh();
	expect(catalog.manifest?.tools.map((t) => t.name)).toEqual([
		"start-session",
		"view",
	]);
});

test("the list is the server's own tools as they were, then ours with our schemas as written", async () => {
	const plain = await connect();
	const own = (await plain.listTools()).tools;
	const ownInstructions = plain.getInstructions();
	await plain.close();

	const c = await connect(await loaded());
	const listed = (await c.listTools()).tools;
	expect(listed.map((t) => t.name)).toEqual([
		...own.map((t) => t.name),
		"start-session",
		"view",
	]);
	for (const tool of own)
		if (tool.name !== "list-mosaics")
			expect(listed.find((t) => t.name === tool.name)).toEqual(tool);
	const start = listed.find((t) => t.name === "start-session");
	expect(start).toEqual({
		name: "start-session",
		title: "Interactive: Start a session",
		description: "Starts a session: one task on one image.",
		inputSchema: nth(fixture().tools, 0).inputSchema,
		annotations: hints,
		execution: { taskSupport: "forbidden" }, // the SDK's, as on the server's own tools
		_meta: { ui: { resourceUri: PAGE } },
	} as unknown as (typeof listed)[0]);
	const mosaics = listed.find((t) => t.name === "list-mosaics");
	expect(mosaics?._meta).toEqual({ ui: { resourceUri: PAGE } });
	// the platform's tools alone have no instructions; with Mapflow Interactive's, the joint block comes first
	expect(ownInstructions).toBeUndefined();
	expect(c.getInstructions()).toBe(
		`${JOINT_INSTRUCTIONS}\n\nMapflow Interactive's workflow.`,
	);
	for (const tool of ["list-models", "calculate-cost", "start-processing"])
		expect(JOINT_INSTRUCTIONS).toContain(tool);
	expect(JOINT_INSTRUCTIONS).not.toMatch(/duty|https?:/);
});

test("a call goes to the app as the user, and its answer comes back as it came", async () => {
	const result = {
		content: [
			{ type: "text", text: '{"sid":"s4"}' },
			{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
		],
		_meta: {
			"mapflow-interactive/widget": {
				tool: "start-session",
				sid: "abc",
				card: 1,
			},
		},
		isError: false,
	};
	answer = (u) =>
		u.pathname === "/api/agent/v1/tools/start-session"
			? Response.json(result)
			: undefined;
	const c = await connect(await loaded());
	const out = await c.callTool({
		name: "start-session",
		arguments: { image: "Harbour", copyQuery: { session: "s1" } },
	});
	expect(out as unknown).toEqual(result);
	const call = seen.find(
		(s) => s.url.pathname === "/api/agent/v1/tools/start-session",
	);
	expect(call?.method).toBe("POST");
	expect(call?.headers.get("authorization")).toBe("Basic test-token");
	expect(call?.headers.get("content-type")).toBe("application/json");
	expect(call?.body).toEqual({
		image: "Harbour",
		copyQuery: { session: "s1" },
	});
});

test("an exchanged token goes on as Bearer", async () => {
	answer = (u) =>
		u.pathname === "/api/agent/v1/tools/view"
			? Response.json({ content: [{ type: "text", text: "{}" }] })
			: undefined;
	const catalog = await loaded();
	const api = createMapflowClient({ scheme: "Bearer", token: "exchanged" });
	const server = createServer({
		getClient: () => api,
		allowEnvToken: false,
		interactive: catalog,
		credentials: { scheme: "Bearer", token: "exchanged" },
	});
	client = new Client({ name: "interactive-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(b);
	await client.connect(a);
	await client.callTool({ name: "view", arguments: { sid: "s4" } });
	const call = seen.find((s) => s.url.pathname === "/api/agent/v1/tools/view");
	expect(call?.headers.get("authorization")).toBe("Bearer exchanged");
});

test("the app's refusals, its being busy and a timeout become tool errors", async () => {
	const c = await connect(await loaded());
	const error = async (response: () => Response | Promise<Response>) => {
		answer = (u) =>
			u.pathname.startsWith("/api/agent/v1/tools/") ? response() : undefined;
		const out = await c.callTool({ name: "view", arguments: { sid: "s4" } });
		expect(out.isError).toBe(true);
		return JSON.parse(nth(out.content as { text: string }[], 0).text);
	};
	expect((await error(() => new Response("", { status: 401 }))).code).toBe(
		"AUTH_REJECTED",
	);
	expect((await error(() => new Response("", { status: 404 }))).code).toBe(
		"NOT_FOUND",
	);
	const busy = await error(
		() => new Response("", { status: 503, headers: { "Retry-After": "7" } }),
	);
	expect(busy).toEqual({
		code: "BUSY",
		message: "Mapflow Interactive is busy; try again in 7 s",
	});
	expect((await error(() => new Response("nope", { status: 200 }))).code).toBe(
		"INVALID_RESPONSE",
	);
	const slow = await error(() => {
		throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
	});
	expect(slow.code).toBe("TIMEOUT");
	// The app's own refusal is a result with isError, passed on as it came.
	answer = (u) =>
		u.pathname.startsWith("/api/agent/v1/tools/")
			? Response.json({
					content: [{ type: "text", text: "no session 's9'" }],
					isError: true,
				})
			: undefined;
	const refused = await c.callTool({ name: "view", arguments: { sid: "s9" } });
	expect(refused).toEqual({
		content: [{ type: "text", text: "no session 's9'" }],
		isError: true,
	});
});

test("the prompt and the card's page come from the app", async () => {
	answer = (u, init) => {
		if (u.pathname === "/api/agent/v1/prompts/find-objects")
			return Response.json({
				description: "The workflow.",
				messages: [{ role: "user", content: { type: "text", text: "Steps…" } }],
			});
		if (u.pathname === "/api/agent/v1/resources") {
			if (new Headers(init?.headers).get("if-none-match") === '"p1"')
				return new Response(null, { status: 304 });
			return Response.json(
				{
					contents: [
						{
							uri: PAGE,
							mimeType: "text/html;profile=mcp-app",
							text: "<!doctype html>",
						},
					],
				},
				{ headers: { ETag: '"p1"' } },
			);
		}
		return undefined;
	};
	const c = await connect(await loaded());
	const prompt = await c.getPrompt({
		name: "find-objects",
		arguments: { task: "cars" },
	});
	expect(nth(prompt.messages, 0).content).toEqual({
		type: "text",
		text: "Steps…",
	});
	expect(
		seen.find((s) => s.url.pathname.endsWith("/find-objects"))?.body,
	).toEqual({
		task: "cars",
	});
	expect((await c.listResources()).resources.map((r) => r.uri)).toEqual([PAGE]);
	for (const _ of [1, 2]) {
		const page = await c.readResource({ uri: PAGE });
		expect((nth(page.contents, 0) as { text: string }).text).toBe(
			"<!doctype html>",
		);
	}
	expect(
		seen.filter((s) => s.url.pathname === "/api/agent/v1/resources"),
	).toHaveLength(2);
});

test("the card attached to list-mosaics is in each of its results", async () => {
	const c = await connect(await loaded());
	const out = await c.callTool({ name: "list-mosaics", arguments: {} });
	expect(out._meta).toEqual({
		"mapflow-interactive/widget": { tool: "list-mosaics" },
	});
	expect(out.structuredContent).toBeDefined();
});

test("a new manifest is listed by the next request, with no restart", async () => {
	const catalog = await loaded();
	const next = fixture();
	next.version = "d4e5f6";
	next.tools.push({
		...nth(next.tools, 1),
		name: "stats",
		title: "Interactive: Run statistics",
	});
	manifestBody = next;
	answer = (u) =>
		u.pathname === "/api/agent/v1/manifest"
			? Response.json(next, { headers: { ETag: '"m2"' } })
			: undefined;
	await catalog.refresh();
	const c = await connect(catalog);
	expect((await c.listTools()).tools.map((t) => t.name)).toContain("stats");
});

test("the schemas go out on the wire as the app wrote them, to the byte", async () => {
	// A client's SDK parses tools/list with its own schema and may order the keys again; what is sent is the app's.
	const manifest = checkManifest(fixture(), reserved);
	const sent: JSONRPCMessage[] = [];
	const inner: Transport = {
		start: async () => {},
		send: async (message) => {
			sent.push(message);
		},
		close: async () => {},
	};
	const transport = interactiveTransport(inner, manifest);
	await transport.start();
	inner.onmessage?.({ jsonrpc: "2.0", id: 7, method: "tools/list" });
	await transport.send({
		jsonrpc: "2.0",
		id: 7,
		result: { tools: [{ name: "view", inputSchema: { type: "object" } }] },
	});
	const listed = (
		nth(sent, 0) as unknown as { result: { tools: { inputSchema: unknown }[] } }
	).result.tools;
	expect(JSON.stringify(nth(listed, 0).inputSchema)).toBe(
		JSON.stringify(nth(fixture().tools, 1).inputSchema),
	);
});
