import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { shouldUseResources } from "../server.js";

describe("shouldUseResources", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clear relevant env vars before each test
		delete process.env.MAPFLOW_USE_RESOURCES;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	test("returns false when MAPFLOW_USE_RESOURCES is not set", () => {
		delete process.env.MAPFLOW_USE_RESOURCES;
		expect(shouldUseResources()).toBe(false);
	});

	test("returns true when MAPFLOW_USE_RESOURCES is 'true'", () => {
		process.env.MAPFLOW_USE_RESOURCES = "true";
		expect(shouldUseResources()).toBe(true);
	});

	test("returns true when MAPFLOW_USE_RESOURCES is '1'", () => {
		process.env.MAPFLOW_USE_RESOURCES = "1";
		expect(shouldUseResources()).toBe(true);
	});

	test("returns false when MAPFLOW_USE_RESOURCES is 'false'", () => {
		process.env.MAPFLOW_USE_RESOURCES = "false";
		expect(shouldUseResources()).toBe(false);
	});

	test("returns false when MAPFLOW_USE_RESOURCES is empty string", () => {
		process.env.MAPFLOW_USE_RESOURCES = "";
		expect(shouldUseResources()).toBe(false);
	});

	test("returns false when MAPFLOW_USE_RESOURCES is '0'", () => {
		process.env.MAPFLOW_USE_RESOURCES = "0";
		expect(shouldUseResources()).toBe(false);
	});
});
