// Mapflow Interactive's tools on this server against a fake app: each call goes to its route as the same user, the
// app's answer is said as the model reads it, a refusal is a tool error, and the card's page and `_meta` are there.

import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CARD_URI, resetCardPage } from "../interactive/card.js";
import { addressOf, TOOLSET } from "../interactive/client.js";
import {
	type InteractiveConfig,
	readInteractiveConfig,
} from "../interactive/index.js";
import { PROSE } from "../interactive/prose.js";
import { ROUTES } from "../interactive/tools.js";
import { createMapflowClient } from "../mapflow-client.js";
import { createServer } from "../mcp-server.js";
import { apiFixture } from "./fixtures.js";

const APP = "https://interactive.example.test";
const MAPFLOW = "https://mapflow.example.test";
const originalFetch = globalThis.fetch;
type Seen = { url: URL; method: string; headers: Headers; body: unknown };
let seen: Seen[];
let answer: (
	url: URL,
	init?: RequestInit,
) => Response | Promise<Response> | undefined;
let client: Client | undefined;

const envelope = (
	result: Record<string, unknown>,
	more: Record<string, unknown> = {},
) => Response.json({ result, pictures: [], card: null, steps: null, ...more });

beforeEach(() => {
	seen = [];
	answer = () => undefined;
	resetCardPage();
	globalThis.fetch = mock(
		async (url: string | URL | Request, init?: RequestInit) => {
			const u = new URL(String(url));
			seen.push({
				url: u,
				method: init?.method ?? "GET",
				headers: new Headers(init?.headers),
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			const given = await answer(u, init);
			if (given) return given;
			if (u.origin === APP) return envelope({ ok: true });
			return Response.json(apiFixture(u));
		},
	) as unknown as typeof fetch;
});
afterEach(async () => {
	await client?.close();
	client = undefined;
	globalThis.fetch = originalFetch;
});

const config = (more: Record<string, string> = {}) =>
	readInteractiveConfig({
		MAPFLOW_INTERACTIVE_URL: APP,
		MAPFLOW_BASE_URL: MAPFLOW,
		...more,
	}) as InteractiveConfig;

/** A client of the server, with Mapflow Interactive's tools (`null`: without them). */
async function connect(interactive: InteractiveConfig | null = config()) {
	await client?.close();
	const api = createMapflowClient("test-token");
	const server = createServer({
		getClient: () => api,
		geometryOwner: "test-user",
		interactive: interactive ?? undefined,
		credentials: "test-token",
	});
	client = new Client({ name: "interactive-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(b);
	await client.connect(a);
	return client;
}

const text = (result: unknown) =>
	((
		(result as { content?: { type: string; text?: string }[] }).content ?? []
	).find((c) => c.type === "text")?.text ?? "") as string;

test("off without MAPFLOW_INTERACTIVE_URL; an https address, or http on a loopback host", () => {
	expect(readInteractiveConfig({})).toBeUndefined();
	expect(
		readInteractiveConfig({
			MAPFLOW_INTERACTIVE_URL: `${APP}/`,
			MAPFLOW_BASE_URL: MAPFLOW,
		}),
	).toEqual({
		baseUrl: APP,
		timeoutMs: 60_000,
		fewshot: true,
		imageOrigins: [MAPFLOW],
	});
	expect(
		readInteractiveConfig({ MAPFLOW_INTERACTIVE_URL: "http://127.0.0.1:8300" })
			?.baseUrl,
	).toBe("http://127.0.0.1:8300");
	expect(() =>
		readInteractiveConfig({
			MAPFLOW_INTERACTIVE_URL: "http://interactive.example.test",
		}),
	).toThrow();
	expect(() =>
		readInteractiveConfig({ MAPFLOW_INTERACTIVE_URL: `${APP}/?k=1` }),
	).toThrow();
	expect(
		readInteractiveConfig({
			MAPFLOW_INTERACTIVE_URL: APP,
			MAPFLOW_INTERACTIVE_FEWSHOT: "0",
			MAPFLOW_INTERACTIVE_TIMEOUT_SECONDS: "90",
			MAPFLOW_INTERACTIVE_CARD_IMAGES:
				"https://a.example.test, https://b.example.test/x",
		}),
	).toEqual({
		baseUrl: APP,
		timeoutMs: 90_000,
		fewshot: false,
		imageOrigins: ["https://a.example.test", "https://b.example.test"],
	});
});

test("a call's path arguments fill its route, the rest go in the query of a GET and the body otherwise", () => {
	const wait = addressOf(APP, ROUTES.wait, { sid: "s4", timeout: 10 });
	expect(wait.url.href).toBe(
		`${APP}/api/agent/v2/sessions/s4/runs/latest?timeout=10`,
	);
	expect(
		addressOf(APP, ROUTES.wait, { sid: "s4", run: "r3" }).url.pathname,
	).toBe("/api/agent/v2/sessions/s4/runs/r3");
	const stats = addressOf(APP, ROUTES.stats, {
		sid: "s 4",
		by: ["cells", "area"],
		run: undefined,
	});
	expect(stats.url.href).toBe(
		`${APP}/api/agent/v2/sessions/s%204/stats?by=cells&by=area`,
	);
	const run = addressOf(APP, ROUTES.run, {
		sid: "s4",
		texts: ["tree"],
		thr: 0.3,
	});
	expect(run.url.pathname).toBe("/api/agent/v2/sessions/s4/runs");
	expect(JSON.parse(run.body as string)).toEqual({ texts: ["tree"], thr: 0.3 });
	expect(() => addressOf(APP, ROUTES.view, {})).toThrow("sid is required");
});

test("a tool calls its route as the user and answers as the model reads it", async () => {
	answer = (u) =>
		u.pathname === "/api/agent/v2/sessions/s4/runs"
			? envelope(
					{
						run: "r1",
						status: "ready",
						count: 3,
						next: { step: "wait", run: "r1" },
						query: { maskThr: 0.5 },
					},
					{
						pictures: [{ mimeType: "image/jpeg", data: "AAAA" }],
						card: { tool: "run", sid: "S123", run: "r1", card: 2, key: "k" },
						steps: "fewshot-steps",
						pictureUrl: `${APP}/agent/S123/img/p1.jpg`,
					},
				)
			: undefined;
	const c = await connect();
	const result = await c.callTool({
		name: "run",
		arguments: { sid: "s4", texts: ["tree"], thr: 0.3 },
	});
	const call = seen.find((s) => s.url.origin === APP) as Seen;
	expect(call.method).toBe("POST");
	expect(call.url.pathname).toBe("/api/agent/v2/sessions/s4/runs");
	expect(call.body).toEqual({
		texts: ["tree"],
		thr: 0.3,
		note: "",
		overview: true,
	});
	expect(call.headers.get("authorization")).toBe("Basic test-token");
	expect(call.headers.get("content-type")).toBe("application/json");
	expect(call.headers.get("x-interactive-toolset")).toBe(TOOLSET);
	expect(result.isError).toBeFalsy();
	const content = result.content as {
		type: string;
		text?: string;
		data?: string;
		mimeType?: string;
	}[];
	expect(JSON.parse(content[0]?.text as string)).toEqual({
		run: "r1",
		status: "ready",
		count: 3,
		next: 'wait(sid, run="r1") for the rest',
		query: { maskThr: 0.5 },
	});
	expect(content[1]).toEqual({
		type: "image",
		data: "AAAA",
		mimeType: "image/jpeg",
	});
	expect(content[2]).toEqual({
		type: "text",
		text: PROSE["fewshot-steps"] as string,
	});
	expect(result._meta).toEqual({
		"mapflow-interactive/widget": {
			tool: "run",
			sid: "S123",
			run: "r1",
			card: 2,
			key: "k",
		},
		"mapflow-interactive/image_url": `${APP}/agent/S123/img/p1.jpg`,
	});
});

test("image-status of an upload is its own route; start-session's cards are filled in", async () => {
	answer = (u) =>
		u.pathname === "/api/agent/v2/sessions"
			? envelope({
					sid: "s1",
					models: [{ name: "sam3", model_card: "sam3" }],
					next: {
						step: "start-session",
						copied: false,
						model: "SAM3",
						kind: null,
					},
				})
			: undefined;
	const c = await connect();
	await c.callTool({ name: "image-status", arguments: { upload: "u1" } });
	await c.callTool({
		name: "image-status",
		arguments: { image: "harbour-1.vrt", preview: true },
	});
	const calls = seen.filter((s) => s.url.origin === APP);
	expect(
		calls.map((s) => `${s.method} ${s.url.pathname}${s.url.search}`),
	).toEqual([
		"GET /api/agent/v2/uploads/u1",
		"GET /api/agent/v2/images/harbour-1.vrt?preview=true",
	]);
	const started = await c.callTool({
		name: "start-session",
		arguments: { image: "harbour-1.vrt" },
	});
	const data = JSON.parse(text(started));
	expect(Object.keys(data.models[0])).toEqual([
		"name",
		"finds",
		"well",
		"badly",
		"speed",
		"tunes",
	]);
	expect(data.next).toStartWith(
		"tell the user the live page link and view the whole image; then write down",
	);
});

test("the app's refusal is the tool's error in its words; a busy app, a refused sign-in and a timeout say so", async () => {
	const c = await connect(
		config({ MAPFLOW_INTERACTIVE_TIMEOUT_SECONDS: "0.2" }),
	);
	answer = () =>
		Response.json(
			{ code: "not_found", message: "no session 's9'" },
			{ status: 404 },
		);
	const refused = await c.callTool({ name: "view", arguments: { sid: "s9" } });
	expect(refused.isError).toBe(true);
	expect(text(refused)).toBe("no session 's9'");
	answer = () =>
		Response.json(
			{ code: "limit", message: "20 sessions a day" },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	const busy = await c.callTool({
		name: "add-image",
		arguments: { mosaic: "m1", aoi: [1, 2, 3, 4] },
	});
	expect(JSON.parse(text(busy))).toEqual({
		code: "BUSY",
		message: "20 sessions a day",
	});
	answer = () => new Response("Sign in", { status: 401 });
	expect(
		JSON.parse(text(await c.callTool({ name: "list-sessions", arguments: {} })))
			.code,
	).toBe("AUTH_REJECTED");
	answer = (_, init) =>
		new Promise((_, reject) =>
			init?.signal?.addEventListener("abort", () =>
				reject(Object.assign(new Error("t"), { name: "TimeoutError" })),
			),
		);
	const late = JSON.parse(
		text(await c.callTool({ name: "wait", arguments: { sid: "s4" } })),
	);
	expect(late.code).toBe("TIMEOUT");
	expect(late.message).toContain("call wait for it");
});

test("an argument a tool doesn't take reaches the app, which says which it takes", async () => {
	answer = () =>
		Response.json(
			{
				code: "refused",
				message:
					"filter takes no min_area (minArea, not min_area); it takes ...",
			},
			{ status: 422 },
		);
	const c = await connect();
	const result = await c.callTool({
		name: "filter",
		arguments: { sid: "s4", min_area: 3 },
	});
	expect((seen.find((s) => s.url.origin === APP) as Seen).body).toEqual({
		min_area: 3,
		unit: "px",
		inAoi: false,
	});
	expect(text(result)).toStartWith("filter takes no min_area");
});

test("the card: its page from the app's address, its sandbox's domains, and on list-mosaics", async () => {
	const c = await connect();
	const resources = (await c.listResources()).resources;
	expect(resources.map((r) => r.uri)).toEqual(
		expect.arrayContaining([CARD_URI, "ui://mapflow/upload.html"]),
	);
	const read = await c.readResource({ uri: CARD_URI });
	const page = read.contents[0] as {
		text: string;
		mimeType: string;
		_meta: Record<string, unknown>;
	};
	expect(page.mimeType).toBe("text/html;profile=mcp-app");
	expect(page.text).toContain(
		`{"base":"${APP}","brand":"Mapflow interactive","platform":true}`,
	);
	expect(page.text).toContain("Leaflet 1.9.4");
	expect(page.text).not.toContain("url(images/");
	expect(page._meta.ui).toEqual({
		csp: { connectDomains: [APP], resourceDomains: [APP, MAPFLOW] },
		prefersBorder: true,
	});
	const tools = (await c.listTools()).tools;
	expect(tools.find((t) => t.name === "list-mosaics")?._meta).toEqual({
		ui: { resourceUri: CARD_URI },
		"ui/resourceUri": CARD_URI,
		"openai/outputTemplate": CARD_URI,
	});
	const listed = await c.callTool({ name: "list-mosaics", arguments: {} });
	expect(listed._meta).toEqual({
		"mapflow-interactive/widget": { tool: "list-mosaics" },
	});
	const cardOnly = tools.filter((t) =>
		(
			t._meta as { ui?: { visibility?: string[] } } | undefined
		)?.ui?.visibility?.includes("app"),
	);
	expect(cardOnly.map((t) => t.name).sort()).toEqual([
		"check-area",
		"list-images",
		"upload-refresh",
	]);
});

test("without the app: the platform's tools alone, no instructions, no card", async () => {
	const c = await connect(null);
	const tools = (await c.listTools()).tools;
	expect(tools.some((t) => t.name === "start-session")).toBe(false);
	expect(tools.find((t) => t.name === "list-mosaics")?._meta).toBeUndefined();
	expect(c.getInstructions()).toBeUndefined();
});

test("without a Fewshot model its tool and arguments are left out", async () => {
	const off = await connect(config({ MAPFLOW_INTERACTIVE_FEWSHOT: "0" }));
	const tools = (await off.listTools()).tools;
	expect(tools.some((t) => t.name === "audit-points")).toBe(false);
	const run = tools.find((t) => t.name === "run")?.inputSchema
		.properties as Record<string, unknown>;
	expect(Object.keys(run)).not.toContain("refine");
	const on = await connect(config());
	expect(
		(await on.listTools()).tools.some((t) => t.name === "audit-points"),
	).toBe(true);
});
