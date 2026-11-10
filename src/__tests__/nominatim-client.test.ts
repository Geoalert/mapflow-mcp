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

	test("city point plus region polygon requires selection instead of silently choosing a region", async () => {
		const point = {
			...mockNominatimResponse[0],
			display_name: "Arusha city",
			geojson: { type: "Point", coordinates: [36.68, -3.37] },
		};
		mockFetch.mockImplementation(() =>
			Promise.resolve(
				Response.json([
					point,
					{ ...mockNominatimResponse[0], display_name: "Arusha region" },
				]),
			),
		);
		await expect(
			createNominatimClient().searchBoundary("Arusha"),
		).rejects.toMatchObject({ code: "PLACE_SELECTION_REQUIRED" });
		const result = await createNominatimClient().searchBoundary("Arusha", true);
		expect(result?.geojson?.type).toBe("Point");
	});
	test("council office suggests an administrative query without leaking coordinates", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(
				Response.json([
					{
						...mockNominatimResponse[0],
						geojson: { type: "Point", coordinates: [36.68, -3.37] },
						address: {
							state_district: "Arusha Municipal",
							country: "Tanzania",
						},
					},
				]),
			),
		);
		try {
			await createNominatimClient().searchBoundary(
				"Arusha City Council, Tanzania",
			);
			throw new Error("Expected selection");
		} catch (error) {
			expect(error).toMatchObject({ code: "PLACE_SELECTION_REQUIRED" });
			expect(String(error)).toContain("Arusha Municipal, Tanzania");
			expect(String(error)).not.toContain("coordinates");
		}
	});
	test("a polygon boundary is returned directly", async () => {
		expect(
			(
				await createNominatimClient().searchBoundary(
					"Arusha Municipal, Tanzania",
				)
			)?.geojson?.type,
		).toBe("Polygon");
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

	test("spaces concurrent requests and recovers after a failed request", async () => {
		const starts: number[] = [];
		mockFetch.mockImplementation(() => {
			starts.push(Date.now());
			return Promise.resolve(
				new Response("[]", { status: starts.length === 1 ? 503 : 200 }),
			);
		});
		const client = createNominatimClient();
		const results = await Promise.allSettled([
			client.searchBoundary("first"),
			client.searchBoundary("second"),
			client.searchBoundary("third"),
		]);
		expect(results.map((result) => result.status)).toEqual([
			"rejected",
			"fulfilled",
			"fulfilled",
		]);
		const [first = 0, second = 0, third = 0] = starts;
		expect(second - first).toBeGreaterThanOrEqual(950);
		expect(third - second).toBeGreaterThanOrEqual(950);
	});
});
