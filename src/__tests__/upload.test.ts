import { afterEach, expect, spyOn, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../mcp-server.js";
import { uploadService } from "../upload/http.js";
import { UPLOAD_CARD } from "../upload/tools.js";
import { id } from "./fixtures.js";

const publicOrigin = "https://mcp.example.test";
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
async function connect(
	uploads: ReturnType<typeof uploadService>,
	interactive: boolean,
	owner = "alice",
) {
	const server = createServer({
		uploads,
		geometryOwner: owner,
		credentials: owner,
		interactive: interactive
			? {
					baseUrl: "https://interactive.example.test",
					imageOrigins: [],
					fewshot: false,
					timeoutMs: 1000,
				}
			: undefined,
	});
	const client = new Client({ name: "upload-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(b);
	await client.connect(a);
	return client;
}
const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0, 1, 2, 3, 4]);
for (const interactive of [false, true]) {
	test(`GeoTIFF card, transport and status use only Mapflow (interactive=${interactive})`, async () => {
		const service = uploadService(() => publicOrigin);
		const c = await connect(service, interactive);
		const other = await connect(service, interactive, "bob");
		const backendCalls: string[] = [];
		globalThis.fetch = (async (input, init) => {
			const request = new Request(String(input), init);
			expect(request.headers.get("authorization")).toBe("Basic alice");
			const url = new URL(request.url);
			expect(url.host).not.toBe("interactive.example.test");
			if (url.pathname.endsWith("/memory")) return Response.json({});
			if (url.pathname === `/rest/rasters/mosaic/${id}`)
				return Response.json({ id, name: "Selected mosaic" });
			backendCalls.push(url.pathname);
			if (request.method === "POST") {
				const body = Buffer.from(await request.arrayBuffer());
				const boundary = request.headers
					.get("content-type")
					?.split("boundary=")[1];
				const headerEnd = body.indexOf("\r\n\r\n");
				expect(body.subarray(0, headerEnd).toString()).toContain(
					'name="file"; filename="field.tif"',
				);
				const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
				expect(body.subarray(-tail.length)).toEqual(tail);
				expect(
					new Uint8Array(body.subarray(headerEnd + 4, -tail.length)),
				).toEqual(bytes);
				expect(Number(request.headers.get("content-length"))).toBe(body.length);
				if (!interactive) expect(url.searchParams.get("name")).toBe("field");
				return Response.json({ mosaic_id: id, image_id: id });
			}
			return Response.json({ id, state: "READY" });
		}) as typeof fetch;
		try {
			const tools = (await c.listTools()).tools.filter(
				(t) => t.name === "upload-image",
			);
			expect(tools).toHaveLength(1);
			expect(tools[0]?._meta?.ui).toEqual({ resourceUri: UPLOAD_CARD });
			const resource = (await c.readResource({ uri: UPLOAD_CARD })).contents[0];
			expect(
				resource && "text" in resource ? resource.text : undefined,
			).toContain("Choose a file");
			expect(
				resource && "text" in resource ? resource.text : undefined,
			).toContain(`"base":"${publicOrigin}"`);
			const started = await c.callTool({
				name: "upload-image",
				arguments: {
					fileName: "field.tif",
					...(interactive ? { mosaicId: id } : {}),
				},
			});
			const { upload, upload_url } = started.structuredContent as {
				upload: string;
				upload_url: string;
			};
			expect((await service.handle(new Request(upload_url))).status).toBe(200);
			expect(
				(
					await other.callTool({
						name: "upload-refresh",
						arguments: { upload },
					})
				).isError,
			).toBe(true);
			expect(
				(await c.callTool({ name: "upload-refresh", arguments: { upload } }))
					.isError,
			).toBeFalsy();
			const put = () =>
				service.handle(
					new Request(`${upload_url}?name=field.tif`, {
						method: "PUT",
						body: bytes,
					}),
				);
			const response = await put();
			expect(await response.json()).toMatchObject({
				state: "processing",
				mosaic: { id },
			});
			expect(response.status).toBe(201);
			expect((await put()).status).toBe(409);
			const result = await c.callTool({
				name: "image-status",
				arguments: { upload },
			});
			expect(result.isError).toBeFalsy();
			expect(result.content).toEqual([
				{ type: "text", text: expect.stringContaining('"state":"ready"') },
			]);
			expect(backendCalls).toEqual([
				interactive
					? `/rest/rasters/mosaic/${id}/image`
					: "/rest/rasters/mosaic/image",
				`/rest/rasters/image/${id}`,
			]);
		} finally {
			await c.close();
			await other.close();
		}
	});
}
test("an attached GeoTIFF is received without forwarding Mapflow credentials to the attachment host", async () => {
	const service = uploadService(() => publicOrigin);
	const actor = { owner: "alice", credentials: "alice" };
	const hosts: string[] = [];
	globalThis.fetch = (async (input, init) => {
		const url = new URL(String(input));
		hosts.push(url.host);
		if (url.host === "files.oaiusercontent.com") {
			expect(new Headers(init?.headers).has("Authorization")).toBe(false);
			return new Response(bytes);
		}
		if (url.pathname.endsWith("/memory")) return Response.json({});
		if (url.pathname === "/rest/rasters/mosaic") return Response.json([]);
		if (init?.method === "POST") {
			await new Request(String(input), init).arrayBuffer();
			return Response.json({ mosaic_id: id, id });
		}
		throw new Error("Unexpected request");
	}) as typeof fetch;
	const up = await service.store.create(actor, {
		file: {
			download_url: "https://files.oaiusercontent.com/attachment",
			file_name: "one.tif",
		},
	});
	for (let i = 0; up.state === "receiving" && i < 100; i++) await Bun.sleep(10);
	expect(up.state).toBe("processing");
	expect(hosts).toHaveLength(4);
	await expect(
		service.store.create(actor, {
			file: { download_url: "https://untrusted.example.test/file.tif" },
		}),
	).rejects.toThrow("Unsupported attachment host");
});
test("invalid GeoTIFFs and expired upload links stop before the backend write", async () => {
	const service = uploadService(() => publicOrigin);
	globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;
	const up = await service.store.create(
		{ owner: "alice", credentials: "a" },
		{},
	);
	const url = `${publicOrigin}/agent/upload/${up.token}`;
	const bad = await service.handle(
		new Request(url, { method: "PUT", body: "not TIFF" }),
	);
	expect(bad.status).toBe(400);
	const expired = await service.store.create(
		{ owner: "alice", credentials: "a" },
		{},
	);
	const now = spyOn(Date, "now").mockReturnValue(Date.now() + 3600001);
	try {
		expect(
			(
				await service.handle(
					new Request(`${publicOrigin}/agent/upload/${expired.token}`, {
						method: "PUT",
						body: bytes,
					}),
				)
			).status,
		).toBe(410);
	} finally {
		now.mockRestore();
	}
});

test("the HTTP file picker receives a browser PUT through Bun's native request stream", async () => {
	const previousBase = Bun.env.MAPFLOW_BASE_URL;
	let received = false;
	const backend = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			if (new URL(request.url).pathname.endsWith("/memory"))
				return Response.json({ maxUploadFileSize: 1024 });
			received =
				Buffer.from(await request.arrayBuffer()).includes(Buffer.from(bytes)) &&
				request.headers.get("authorization") === "Basic alice";
			return Response.json({ mosaic_id: id, id });
		},
	});
	const service = uploadService(() => listener.url.origin);
	const listener = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: service.handle,
	});
	try {
		Bun.env.MAPFLOW_BASE_URL = backend.url.origin;
		const upload = await service.store.create(
			{ owner: "alice", credentials: "alice" },
			{ fileName: "field.tif" },
		);
		const url = `${listener.url.origin}/agent/upload/${upload.token}`;
		const preflight = await fetch(url, {
			method: "OPTIONS",
			headers: { Origin: "null", "Access-Control-Request-Method": "PUT" },
		});
		expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
		const sent = await fetch(url, {
			method: "PUT",
			body: bytes,
			headers: { Origin: "null" },
		});
		expect(await sent.json()).toMatchObject({
			state: "processing",
			mosaic: { id },
			image_id: id,
		});
		expect(sent.status).toBe(201);
		expect(received).toBe(true);
	} finally {
		listener.stop(true);
		backend.stop(true);
		if (previousBase === undefined) delete Bun.env.MAPFLOW_BASE_URL;
		else Bun.env.MAPFLOW_BASE_URL = previousBase;
	}
});

test("Mapflow storage rights and account size limits govern base uploads", async () => {
	const service = uploadService(() => publicOrigin);
	const actor = { owner: "alice", credentials: "alice" };
	let refuse = true;
	globalThis.fetch = (async (input) => {
		expect(new URL(String(input)).pathname).toBe("/rest/rasters/memory");
		return refuse
			? new Response(null, { status: 403 })
			: Response.json({ maxUploadFileSize: 4096, memoryFree: 7 });
	}) as typeof fetch;
	await expect(service.store.create(actor, {})).rejects.toThrow("403");
	refuse = false;
	await expect(service.store.create(actor, { fileSize: 8 })).rejects.toThrow(
		"storage limit",
	);
});

test("an existing SHA-1 reuses the caller's ready image without a write", async () => {
	const service = uploadService(() => publicOrigin);
	const sha1 = "1".repeat(40);
	globalThis.fetch = (async (input, init) => {
		expect(init?.method ?? "GET").toBe("GET");
		expect(new Headers(init?.headers).get("authorization")).toBe("Basic alice");
		return new URL(String(input)).pathname.endsWith("/image")
			? Response.json([{ id, state: "ready", checksum: sha1 }])
			: Response.json([{ id, name: "Existing" }]);
	}) as typeof fetch;
	const upload = await service.store.create(
		{ owner: "alice", credentials: "alice" },
		{ sha1 },
	);
	expect(upload.result(publicOrigin)).toMatchObject({
		state: "ready",
		existing: true,
		image_id: id,
		mosaic: { id, name: "Existing" },
	});
});
