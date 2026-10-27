import { expect, test } from "bun:test";

type Entry = {
	event: string;
	level: string;
	requestId: string;
	tool?: string;
	outcome: string;
	durationMs: number;
	errorCode?: string;
	status?: number;
	upstream?: string;
};
async function capture(level: string) {
	const child = Bun.spawn(
		[process.execPath, "src/__tests__/logging.fixture.ts"],
		{
			env: { ...process.env, LOG_LEVEL: level },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exit] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(exit).toBe(0);
	const logs: Entry[] = stderr.trim()
		? stderr
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
		: [];
	return { logs, stderr, result: JSON.parse(stdout) };
}

test("JSON stderr logs correlate concurrent HTTP, MCP and API calls without input or output leakage", async () => {
	const { logs, stderr, result } = await capture("info");
	expect(stderr).not.toContain("PRIVATE_");
	expect(stderr).not.toContain("123456789");
	expect(result.concurrent[0].requestId).not.toBe(
		result.concurrent[1].requestId,
	);
	for (const call of result.concurrent) {
		expect(call.failed).toBe(false);
		const chain = logs.filter((entry) => entry.requestId === call.requestId);
		expect(chain.map((entry) => entry.event).sort()).toEqual([
			"api.completed",
			"http.completed",
			"tool.completed",
		]);
		expect(chain.every((entry) => entry.outcome === "success")).toBe(true);
		expect(
			chain
				.filter((entry) => entry.event !== "http.completed")
				.every((entry) => entry.tool === "get-limits"),
		).toBe(true);
	}
	for (const entry of logs) {
		expect(entry.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(entry.durationMs).toBeGreaterThanOrEqual(0);
	}
	for (const [i, code] of [
		"HTTP_502",
		"NETWORK_ERROR",
		"INVALID_RESPONSE",
	].entries()) {
		const call = result.errors[i];
		expect(call.failed).toBe(true);
		const chain = logs.filter((entry) => entry.requestId === call.requestId);
		expect(chain.filter((entry) => entry.errorCode === code)).toHaveLength(2);
		// HTTP 200 carries an MCP tool error; it must not hide the tool outcome.
		expect(
			chain.find((entry) => entry.event === "http.completed")?.status,
		).toBe(200);
	}
	for (const call of [result.invalid, result.unknown]) {
		expect(call.failed).toBe(true);
		const chain = logs.filter((entry) => entry.requestId === call.requestId);
		expect(chain.some((entry) => entry.event === "api.completed")).toBe(false);
		expect(
			chain.find((entry) => entry.event === "tool.completed")?.outcome,
		).toBe("error");
	}
	expect(
		logs.find(
			(entry) =>
				entry.requestId === result.unknown.requestId &&
				entry.event === "tool.completed",
		)?.tool,
	).toBe("unknown");
	expect(
		logs.find(
			(entry) =>
				entry.requestId === result.nominatim.requestId &&
				entry.event === "api.completed",
		)?.upstream,
	).toBe("nominatim");
	expect(
		logs.find((entry) => entry.event === "oauth.completed")?.errorCode,
	).toBe("invalid_token");
	expect(result.missing).toBe(404);
	expect(result.unauthorized).toBe(401);
});

test("LOG_LEVEL filters real stderr output and invalid levels fall back safely", async () => {
	const errors = await capture("error");
	expect(errors.logs.length).toBeGreaterThan(0);
	expect(errors.logs.every((entry) => entry.level === "error")).toBe(true);
	expect((await capture("silent")).stderr).toBe("");
	const invalid = await capture("PRIVATE_INVALID_LEVEL");
	expect(invalid.logs.some((entry) => entry.level === "info")).toBe(true);
	expect(invalid.stderr).not.toContain("PRIVATE_");
});

test("an unavailable stderr sink preserves successful operations and original errors", async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			"--eval",
			`
		import { closeSync } from "node:fs";
		import { observe } from "./src/logging.ts";
		closeSync(2);
		const value = await observe("api.completed", { service: "mapflow" }, async () => 42);
		const original = new Error("PRIVATE_ERROR");
		let preserved = false;
		try { await observe("api.completed", {}, async () => { throw original; }); }
		catch (error) { preserved = error === original; }
		process.stdout.write(JSON.stringify({ value, preserved }));
	`,
		],
		{
			env: { ...process.env, LOG_LEVEL: "info" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, exit] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	expect(exit).toBe(0);
	expect(JSON.parse(stdout)).toEqual({ value: 42, preserved: true });
});
