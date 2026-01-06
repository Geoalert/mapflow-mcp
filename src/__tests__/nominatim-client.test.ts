import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createNominatimClient } from "../nominatim-client.js";

const mockNominatimResponse = [
	{
		place_id: 123,
		osm_type: "relation",
		osm_id: 456,
		lat: "51.5074",
		lon: "-0.1278",
		display_name: "London, UK",
		boundingbox: ["51.28", "51.69", "-0.51", "0.33"],
		geojson: {
			type: "Polygon",
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 0],
				],
			],
		},
	},
];

describe("NominatimClient rate limiting", () => {
	let originalFetch: typeof fetch;
	let mockFetch: ReturnType<typeof mock>;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		mockFetch = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify(mockNominatimResponse), {
					status: 200,
				}),
			),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("first request executes without delay", async () => {
		const client = createNominatimClient();
		const start = Date.now();

		await client.searchBoundary("London");

		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(500); // Should be fast (network mocked)
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	test("enforces minimum 1000ms interval between requests", async () => {
		const client = createNominatimClient();

		const start = Date.now();
		await client.searchBoundary("London");
		await client.searchBoundary("Paris");
		const elapsed = Date.now() - start;

		expect(elapsed).toBeGreaterThanOrEqual(950); // Allow 50ms tolerance
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	test("allows immediate request after 1000ms gap", async () => {
		const client = createNominatimClient();

		await client.searchBoundary("London");

		// Wait for 1000ms
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const start = Date.now();
		await client.searchBoundary("Paris");
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(500); // Should be immediate
	});

	test("returns null when no results found", async () => {
		mockFetch.mockImplementationOnce(() =>
			Promise.resolve(new Response("[]", { status: 200 })),
		);

		const client = createNominatimClient();
		const result = await client.searchBoundary("nonexistent place xyz");

		expect(result).toBeNull();
	});
});
