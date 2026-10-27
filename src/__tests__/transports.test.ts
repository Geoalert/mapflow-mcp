import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const env = {
	PATH: process.env.PATH ?? "",
	MAPFLOW_TOKEN: "smoke-token",
	MAPFLOW_BASE_URL: "http://127.0.0.1:1",
};
test("stdio entrypoint initializes, lists tools and computes a buffer", async () => {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ["src/server.ts"],
		env: { ...env, MAPFLOW_TRANSPORT: "stdio" },
		stderr: "pipe",
	});
	const client = new Client({ name: "stdio-smoke", version: "1" });
	try {
		await client.connect(transport);
		expect((await client.listTools()).tools).toHaveLength(18);
		const result = await client.callTool({
			name: "buffer-aoi",
			arguments: {
				geometry: { type: "Point", coordinates: [0, 0] },
				distanceMeters: 100,
			},
		});
		expect(result.isError).not.toBe(true);
	} finally {
		await client.close();
		await transport.close();
	}
});
test("HTTP entrypoint supports repeated requests and independent clients", async () => {
	const reservation = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: () => new Response(),
	});
	const port = reservation.port;
	reservation.stop(true);
	const backend = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (req) =>
			Response.json({
				remainingCredits:
					req.headers.get("authorization") === "Basic token-0" ? 10 : 20,
			}),
	});
	const child = Bun.spawn([process.execPath, "src/server.ts"], {
		env: {
			...env,
			MAPFLOW_TRANSPORT: "http",
			PORT: String(port),
			MAPFLOW_BASE_URL: `http://127.0.0.1:${backend.port}`,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const clients: Client[] = [];
	try {
		let ready = false;
		for (let attempt = 0; attempt < 60; attempt++) {
			try {
				await fetch(`http://127.0.0.1:${port}/missing`);
				ready = true;
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
		expect(ready).toBe(true);
		for (let n = 0; n < 2; n++) {
			const c = new Client({ name: `http-smoke-${n}`, version: "1" });
			clients.push(c);
			await c.connect(
				new StreamableHTTPClientTransport(
					new URL(`http://127.0.0.1:${port}/mcp`),
					{ requestInit: { headers: { Authorization: `Bearer token-${n}` } } },
				),
			);
			expect((await c.listTools()).tools).toHaveLength(18);
			expect((await c.listTools()).tools).toHaveLength(18);
			const limits = await c.callTool({ name: "get-limits", arguments: {} });
			expect(limits.structuredContent).toEqual({
				remainingCredits: n === 0 ? 10 : 20,
			});
		}
	} finally {
		for (const c of clients) await c.close();
		child.kill();
		await child.exited;
		backend.stop(true);
	}
}, 10000);
