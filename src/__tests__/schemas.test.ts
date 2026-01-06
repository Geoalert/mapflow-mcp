import { describe, expect, test } from "bun:test";
import {
	geoJsonGeometrySchema,
	mapflowModelSchema,
	mapflowUserStatusSchema,
	nominatimResultSchema,
} from "../schemas.js";

describe("mapflowUserStatusSchema", () => {
	test("validates complete user status", () => {
		const validData = {
			email: "user@example.com",
			processedArea: 150.5,
			remainingArea: 849.5,
			areaLimit: 1000,
			memoryLimit: 512,
			models: [],
			teams: [],
		};

		const result = mapflowUserStatusSchema.safeParse(validData);
		expect(result.success).toBe(true);
	});

	test("validates empty object (all fields optional)", () => {
		const result = mapflowUserStatusSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	test("rejects invalid email format", () => {
		const invalidData = {
			email: "not-an-email",
		};

		const result = mapflowUserStatusSchema.safeParse(invalidData);
		expect(result.success).toBe(false);
	});

	test("allows extra fields via catchall", () => {
		const dataWithExtras = {
			email: "user@example.com",
			unknownField: "some value",
		};

		const result = mapflowUserStatusSchema.safeParse(dataWithExtras);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.unknownField).toBe("some value");
		}
	});
});

describe("mapflowModelSchema", () => {
	test("validates complete model", () => {
		const validModel = {
			id: "550e8400-e29b-41d4-a716-446655440000",
			name: "building-detection",
			description: "Detects buildings from satellite imagery",
			created: "2024-01-01T00:00:00Z",
			updated: "2024-06-01T00:00:00Z",
			pricePerSqKm: 0.5,
			blocks: [{ name: "simplify", displayName: "Simplify", optional: true }],
		};

		const result = mapflowModelSchema.safeParse(validModel);
		expect(result.success).toBe(true);
	});

	test("rejects invalid uuid for id", () => {
		const invalidModel = {
			id: "not-a-uuid",
		};

		const result = mapflowModelSchema.safeParse(invalidModel);
		expect(result.success).toBe(false);
	});

	test("accepts null description", () => {
		const modelWithNullDesc = {
			id: "550e8400-e29b-41d4-a716-446655440000",
			description: null,
		};

		const result = mapflowModelSchema.safeParse(modelWithNullDesc);
		expect(result.success).toBe(true);
	});
});

describe("nominatimResultSchema", () => {
	test("validates complete nominatim result", () => {
		const validResult = {
			place_id: 12345,
			osm_type: "relation",
			osm_id: 67890,
			lat: "51.5074",
			lon: "-0.1278",
			display_name: "London, Greater London, England, United Kingdom",
			boundingbox: ["51.28", "51.69", "-0.51", "0.33"],
			geojson: {
				type: "Polygon",
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 1],
						[0, 0],
					],
				],
			},
		};

		const result = nominatimResultSchema.safeParse(validResult);
		expect(result.success).toBe(true);
	});

	test("requires place_id field", () => {
		const missingPlaceId = {
			lat: "51.5074",
			lon: "-0.1278",
			display_name: "London",
		};

		const result = nominatimResultSchema.safeParse(missingPlaceId);
		expect(result.success).toBe(false);
	});

	test("requires lat and lon as strings", () => {
		const numericLatLon = {
			place_id: 123,
			lat: 51.5074,
			lon: -0.1278,
			display_name: "London",
		};

		const result = nominatimResultSchema.safeParse(numericLatLon);
		expect(result.success).toBe(false);
	});
});

describe("geoJsonGeometrySchema", () => {
	test("validates polygon geometry", () => {
		const polygon = {
			type: "Polygon",
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 1],
					[0, 0],
				],
			],
		};

		const result = geoJsonGeometrySchema.safeParse(polygon);
		expect(result.success).toBe(true);
	});

	test("validates multipolygon geometry", () => {
		const multiPolygon = {
			type: "MultiPolygon",
			coordinates: [
				[
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 0],
					],
				],
			],
		};

		const result = geoJsonGeometrySchema.safeParse(multiPolygon);
		expect(result.success).toBe(true);
	});

	test("requires type field", () => {
		const noType = {
			coordinates: [[[0, 0]]],
		};

		const result = geoJsonGeometrySchema.safeParse(noType);
		expect(result.success).toBe(false);
	});
});
