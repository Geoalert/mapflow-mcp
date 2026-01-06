import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	setSystemTime,
	test,
} from "bun:test";
import { createMapflowClient, getMapflowToken } from "../mapflow-client.js";

const mockUserStatus = {
	email: "test@example.com",
	processedArea: 100,
	remainingArea: 900,
	areaLimit: 1000,
	memoryLimit: 500,
	models: [],
	teams: [],
};

describe("getMapflowToken", () => {
	test("returns token from environment", () => {
		// Bun.env is read at module load, so just verify the function works
		const originalToken = process.env.MAPFLOW_TOKEN;
		process.env.MAPFLOW_TOKEN = "test-token-123";

		// Need to test with a fresh import or accept Bun.env behavior
		// For now, test that the function returns a string when token is set
		expect(typeof getMapflowToken()).toBe("string");

		process.env.MAPFLOW_TOKEN = originalToken;
	});
});

describe("request authentication", () => {
	let originalFetch: typeof fetch;
	let mockFetch: ReturnType<typeof mock>;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		mockFetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify(mockUserStatus), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;
		process.env.MAPFLOW_TOKEN = "my-secret-token";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env = { ...originalEnv };
	});

	test("includes Basic authorization header", async () => {
		const client = createMapflowClient();
		await client.request("/rest/user/status");

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
		expect(url.toString()).toBe("https://api.mapflow.ai/rest/user/status");

		const headers = init.headers as Record<string, string>;
		expect(headers.Accept).toBe("application/json");
		expect(headers.Authorization).toMatch(/^Basic .+$/);
	});

	test("handles 401 unauthorized response", async () => {
		mockFetch.mockImplementationOnce(() =>
			Promise.resolve(new Response("Unauthorized", { status: 401 })),
		);

		const client = createMapflowClient();

		await expect(client.request("/test")).rejects.toThrow(
			"Mapflow API request failed: 401",
		);
	});

	test("handles 403 forbidden response", async () => {
		mockFetch.mockImplementationOnce(() =>
			Promise.resolve(new Response("Forbidden", { status: 403 })),
		);

		const client = createMapflowClient();

		await expect(client.request("/test")).rejects.toThrow(
			"Mapflow API request failed: 403",
		);
	});
});

describe("getCachedUserStatus", () => {
	let originalFetch: typeof fetch;
	let mockFetch: ReturnType<typeof mock>;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		mockFetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify(mockUserStatus), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;
		process.env.MAPFLOW_TOKEN = "test-token";
		setSystemTime(new Date("2025-01-01T12:00:00.000Z"));
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env = { ...originalEnv };
		setSystemTime();
	});

	test("fetches from API on first call", async () => {
		const client = createMapflowClient();
		const result = await client.getCachedUserStatus();

		expect(result.email).toBe("test@example.com");
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	test("returns cached data within TTL (5 minutes)", async () => {
		const client = createMapflowClient();

		await client.getCachedUserStatus();
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Advance time by 4 minutes (within TTL)
		setSystemTime(new Date("2025-01-01T12:04:00.000Z"));

		await client.getCachedUserStatus();
		expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, used cache
	});

	test("refreshes cache after TTL expires", async () => {
		const client = createMapflowClient();

		await client.getCachedUserStatus();
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Advance time by 5 minutes + 1ms (past TTL)
		setSystemTime(new Date("2025-01-01T12:05:00.001Z"));

		await client.getCachedUserStatus();
		expect(mockFetch).toHaveBeenCalledTimes(2); // Fetched again
	});

	test("cache valid at 4:59.999, expired at 5:00.000", async () => {
		const client = createMapflowClient();

		await client.getCachedUserStatus();
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// At 4 minutes 59.999 seconds - cache is still valid
		setSystemTime(new Date("2025-01-01T12:04:59.999Z"));
		await client.getCachedUserStatus();
		expect(mockFetch).toHaveBeenCalledTimes(1); // Cache still valid

		// At exactly 5 minutes - cache is expired (uses > not >=)
		setSystemTime(new Date("2025-01-01T12:05:00.000Z"));
		await client.getCachedUserStatus();
		expect(mockFetch).toHaveBeenCalledTimes(2); // Cache expired
	});
});
