// Mapflow Interactive's tools and texts on this server against what its app's doors listed and said when they moved
// here (fixtures/interactive/, the app's export of 2026-11-16): the same names, titles, hints, descriptions and
// arguments, the same instructions and prompts but for the uploads (now this server's), and every `next` worded as
// the app worded it. When a text is changed here on purpose, its fixture or the edits below change with it.

import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	JOINT_INSTRUCTIONS,
	readInteractiveConfig,
} from "../interactive/index.js";
import { wordNext } from "../interactive/next.js";
import { CARDS, PROSE } from "../interactive/prose.js";
import { interactiveTools, ROUTES } from "../interactive/tools.js";
import { createMapflowClient } from "../mapflow-client.js";
import { createServer } from "../mcp-server.js";

const FIXTURES = new URL("./fixtures/interactive/", import.meta.url);
const fixture = async (name: string) =>
	JSON.parse(await Bun.file(new URL(name, FIXTURES)).text());

type Json = Record<string, unknown>;
type Door = {
	instructions: string;
	tools: Json[];
	prompts: (Json & { text: string })[];
};

// The uploads are this server's tools now (the app's decision 4): where the platform's door sent a GeoTIFF to
// Mapflow's My data page, the intake says upload-image, in the app's own door's words.
const INTAKE_EDITS: [string, string][] = [
	[
		"a GeoTIFF the user has goes into MyImagery on Mapflow's My data page first.",
		"a GeoTIFF the user attached or has: upload-image puts it into their MyImagery as a new mosaic (ChatGPT passes the attachment as file; elsewhere follow its answer's next: send the file from your code sandbox or the user's computer, else the user drops it on the card in the chat; a file over its limits.max_file the user uploads on Mapflow's My data page, my_data), then image-status(upload=...) until it is ready.",
	],
	[
		"   - A file the user has (a GeoTIFF attached to the chat or on their computer) goes into MyImagery on Mapflow's My data page first: MyImagery takes only georeferenced GeoTIFFs. Then list-mosaics lists its mosaic.",
		"   - A file the user has (they attached a GeoTIFF to the chat, or name one on their computer): upload-image puts it into their MyImagery as a new mosaic named after it. ChatGPT passes the attachment as file. Elsewhere pass fileName and fileSize, and sha1 if you can compute it (a file already in MyImagery isn't sent again), then follow the answer's next: send the file with its send command from your code sandbox (claude.ai: /mnt/user-data/uploads/...; it reaches the service only if the user allowed its host, so if the command fails, don't retry it: the user drops the same file on the card in the chat) or from the user's computer (Claude Code, Codex). image-status(upload=...) until it is ready: MyImagery checks the file and makes its map layer, a minute or more for a large one. MyImagery takes only georeferenced GeoTIFFs, and the service files up to the answer's limits.max_file: a larger one the user uploads on Mapflow's My data page (the answer's my_data), and you take its mosaic from list-mosaics.",
	],
];
const edited = (text: string) =>
	INTAKE_EDITS.reduce(
		(t, [from, to]) => (t.includes(from) ? t.replace(from, to) : t),
		text,
	);

let client: Client | undefined;
afterEach(async () => {
	await client?.close();
	client = undefined;
});

async function connect(fewshot: boolean) {
	const interactive = readInteractiveConfig({
		MAPFLOW_INTERACTIVE_URL: "https://interactive.example.test",
		MAPFLOW_INTERACTIVE_FEWSHOT: fewshot ? "1" : "0",
	});
	const api = createMapflowClient("test-token");
	const server = createServer({
		getClient: () => api,
		interactive,
		credentials: "test-token",
	});
	client = new Client({ name: "texts-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(b);
	await client.connect(a);
	return client;
}

// --- JSON Schemas as their meaning ---

const SAFE_INT = 9007199254740991;

function resolve(schema: unknown, defs: Json): Json {
	let s = schema as Json;
	while (s && typeof s === "object" && typeof s.$ref === "string") {
		const { $ref, ...rest } = s;
		s = {
			...(defs[($ref as string).split("/").pop() as string] as Json),
			...rest,
		};
	}
	return s;
}

/** A schema's types, enums, limits, defaults, descriptions and shape; no titles, an optional one's null left out. */
function norm(schema: unknown, defs: Json): unknown {
	const s = resolve(schema, defs);
	if (!s || typeof s !== "object") return s;
	if (Array.isArray(s.anyOf)) {
		const options = (s.anyOf as unknown[]).filter(
			(o) => JSON.stringify(resolve(o, defs)) !== '{"type":"null"}',
		);
		const { anyOf, ...rest } = s;
		if (options.length === 1)
			return norm({ ...resolve(options[0], defs), ...rest }, defs);
		const parts = options
			.map((o) => norm(o, defs))
			.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
		return { ...(norm(rest, defs) as Json), anyOf: parts };
	}
	const out: Json = {};
	for (const key of [
		"type",
		"enum",
		"const",
		"minimum",
		"maximum",
		"exclusiveMinimum",
		"exclusiveMaximum",
		"minLength",
		"maxLength",
		"minItems",
		"maxItems",
		"pattern",
		"default",
		"description",
	])
		if (key in s && s[key] !== null) out[key] = s[key];
	if (Array.isArray(out.enum) && out.enum.length === 1) {
		out.const = out.enum[0];
		delete out.enum;
	}
	if ("enum" in out || "const" in out) delete out.type;
	if (out.minimum === -SAFE_INT) delete out.minimum;
	if (out.maximum === SAFE_INT) delete out.maximum;
	if (s.items !== undefined) out.items = norm(s.items, defs);
	if (s.properties && typeof s.properties === "object")
		out.properties = Object.fromEntries(
			Object.entries(s.properties as Json).map(([k, v]) => [k, norm(v, defs)]),
		);
	if (Array.isArray(s.required) && s.required.length)
		out.required = [...(s.required as string[])].sort();
	const extra = s.additionalProperties;
	if (extra && typeof extra === "object" && Object.keys(extra).length)
		out.additionalProperties = norm(extra, defs);
	return out;
}

const props = (inputSchema: Json) => {
	const defs =
		((inputSchema.$defs ?? inputSchema.definitions ?? {}) as Json) ?? {};
	return {
		properties: Object.fromEntries(
			Object.entries((inputSchema.properties ?? {}) as Json).map(([k, v]) => [
				k,
				norm(v, defs),
			]),
		),
		required: [...((inputSchema.required ?? []) as string[])].sort(),
	};
};

// --- The tools ---

for (const variant of ["sam3", "fewshot"] as const) {
	test(`the tools are the app's door's, with the uploads of its own door (${variant})`, async () => {
		const platform: Door = await fixture(`platform-${variant}.json`);
		const own: Door = await fixture(`own-${variant}.json`);
		const c = await connect(variant === "fewshot");
		const listed = (await c.listTools()).tools;
		const ours = new Map(
			interactiveTools(variant === "fewshot").map((t) => [t.name, t]),
		);
		const mine = new Map(
			listed
				.filter((t) => ours.has(t.name))
				.map((t) => [t.name, t as unknown as Json]),
		);
		const expected = new Map<string, Json>(
			platform.tools.map((t) => [t.name as string, t]),
		);
		for (const name of ["upload-image", "upload-refresh"]) {
			const t = own.tools.find((x) => x.name === name) as Json;
			expected.set(name, { ...t, title: `Interactive: ${t.title}` });
		}
		const status = expected.get("image-status") as Json;
		const ownStatus = own.tools.find((x) => x.name === "image-status") as Json;
		const statusSchema = status.inputSchema as Json;
		const withUpload: Json = {};
		for (const [k, v] of Object.entries(statusSchema.properties as Json)) {
			withUpload[k] = v;
			if (k === "image")
				withUpload.upload = (
					(ownStatus.inputSchema as Json).properties as Json
				).upload;
		}
		expected.set("image-status", {
			...status,
			inputSchema: { ...statusSchema, properties: withUpload },
		});

		expect([...mine.keys()].sort()).toEqual([...expected.keys()].sort());
		for (const [name, want] of expected) {
			const got = mine.get(name) as Json;
			expect({ name, title: got.title }).toEqual({ name, title: want.title });
			expect({ name, description: got.description }).toEqual({
				name,
				description: want.description,
			});
			expect({ name, annotations: got.annotations }).toEqual({
				name,
				annotations: want.annotations,
			});
			expect({ name, _meta: got._meta }).toEqual({ name, _meta: want._meta });
			expect({ name, ...props(got.inputSchema as Json) }).toEqual({
				name,
				...props(want.inputSchema as Json),
			});
			expect(got.outputSchema).toBeUndefined(); // a host holding an old one could refuse a correct answer
		}
	});

	test(`the instructions and the prompts are the app's door's, the intake saying upload-image (${variant})`, async () => {
		const platform: Door = await fixture(`platform-${variant}.json`);
		const c = await connect(variant === "fewshot");
		expect(c.getInstructions()).toBe(
			`${JOINT_INSTRUCTIONS}\n\n${edited(platform.instructions)}`,
		);
		expect(c.getInstructions()).not.toContain("My data page first");
		const prompts = (await c.listPrompts()).prompts;
		expect(prompts.map((p) => p.name).sort()).toEqual(
			platform.prompts.map((p) => p.name as string).sort(),
		);
		for (const want of platform.prompts) {
			const got = prompts.find((p) => p.name === want.name);
			expect(got?.title).toBe(want.title as string);
			expect(got?.description).toBe(want.description as string);
			const text = (
				await c.getPrompt({ name: want.name as string, arguments: {} })
			).messages[0]?.content;
			expect(text).toEqual({ type: "text", text: edited(want.text) });
			const asked = (
				await c.getPrompt({
					name: want.name as string,
					arguments: { task: "count the cars" },
				})
			).messages[0]?.content as { text: string };
			expect(asked.text).toBe(
				`${edited(want.text)}\n\nThe user's task: count the cars`,
			);
		}
	});
}

test("every next is worded as the app worded it", async () => {
	const cases: { next: unknown; words: string }[] =
		await fixture("next-steps.json");
	expect(cases.length).toBeGreaterThanOrEqual(50);
	for (const c of cases)
		expect({ next: c.next, words: wordNext(c.next) }).toEqual({
			next: c.next,
			words: c.words,
		});
});

test("the prose and the models' cards are the app's", async () => {
	const prose = await fixture("prose.json");
	for (const key of Object.keys(PROSE))
		expect({ key, text: PROSE[key] }).toEqual({ key, text: prose.prose[key] });
	expect(CARDS).toEqual(prose.cards);
});

test("each tool takes at its route the arguments the app's OpenAPI names, and needs the ones it needs", async () => {
	const spec = await fixture("openapi-v2.json");
	const components = spec.components.schemas as Json;
	const byOperation = new Map<string, Json>();
	for (const [path, item] of Object.entries(spec.paths as Record<string, Json>))
		for (const [method, op] of Object.entries(item))
			byOperation.set((op as Json).operationId as string, {
				...(op as Json),
				method: method.toUpperCase(),
				path,
			});
	for (const tool of interactiveTools(true)) {
		const routes =
			tool.name === "image-status" ? [tool.name, "upload-status"] : [tool.name];
		const theirs = new Set<string>();
		const needed = new Set<string>();
		for (const operation of routes) {
			const op = byOperation.get(operation) as Json;
			expect({ tool: tool.name, operation, found: !!op }).toEqual({
				tool: tool.name,
				operation,
				found: true,
			});
			const route = ROUTES[operation as keyof typeof ROUTES];
			expect({
				operation,
				method: route.method as string,
				path: route.path as string,
			}).toEqual({
				operation,
				method: op.method as string,
				path: op.path as string,
			});
			for (const p of (op.parameters ?? []) as Json[]) {
				theirs.add(p.name as string);
				if (p.required && routes.length === 1 && p.name !== "run")
					needed.add(p.name as string);
			}
			const body = (
				(op.requestBody as Json | undefined)?.content as Json | undefined
			)?.["application/json"] as Json | undefined;
			if (body) {
				let schema = resolve(body.schema, components);
				const options = (schema.anyOf as Json[] | undefined)?.filter(
					(o) => o.type !== "null",
				);
				if (options?.[0]) schema = resolve(options[0], components);
				for (const k of Object.keys((schema.properties ?? {}) as Json))
					theirs.add(k);
				for (const k of (schema.required ?? []) as string[]) needed.add(k);
			}
		}
		const mine = Object.keys(tool.inputSchema);
		const required = mine.filter(
			(k) =>
				!(
					tool.inputSchema[k] as unknown as { isOptional: () => boolean }
				).isOptional(),
		);
		expect({ tool: tool.name, arguments: mine.sort() }).toEqual({
			tool: tool.name,
			arguments: [...theirs].sort(),
		});
		expect({ tool: tool.name, required: required.sort() }).toEqual({
			tool: tool.name,
			required: [...needed].sort(),
		});
	}
});

test("Mapflow Interactive's files name no internal host", async () => {
	const internal =
		/idono\.work|mapflow-interactive-duty|minio-[a-z]+\.mapflow|\b10\.\d+\.\d+\.\d+\b|192\.168\./i;
	const glob = new Bun.Glob("**/*");
	for (const base of ["../interactive/", "./fixtures/interactive/"]) {
		const dir = new URL(base, import.meta.url).pathname.replace(
			/^\/([A-Za-z]:)/,
			"$1",
		);
		for await (const path of glob.scan({ cwd: dir, onlyFiles: true })) {
			if (path.includes("vendor")) continue;
			const text = await Bun.file(`${dir}/${path}`).text();
			expect({ path, internal: internal.exec(text)?.[0] }).toEqual({
				path,
				internal: undefined,
			});
		}
	}
});
