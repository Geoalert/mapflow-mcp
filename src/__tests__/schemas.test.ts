import { describe, expect, test } from "bun:test";
import {
	geoJsonGeometrySchema,
	mapflowDataProviderPriceSchema,
	mapflowDataProviderSchema,
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
			remainingCredits: 1000,
			areaLimit: 1000,
			maxAoisPerProcessing: 10,
			memoryLimit: 512,
			billingType: 1,
			models: [],
			teams: [],
			dataProviders: [],
			reviewWorkflowEnabled: true,
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

	test("validates dataProviders array", () => {
		const validData = {
			dataProviders: [
				{
					id: "550e8400-e29b-41d4-a716-446655440000",
					name: "maxar",
					displayName: "Maxar SecureWatch",
					previewUrl: "https://example.com/tiles/{z}/{x}/{y}",
					previewUrlMaxZoom: 18,
					price: [{ zoom: 18, priceSqKm: 0.5 }],
				},
			],
		};

		const result = mapflowUserStatusSchema.safeParse(validData);
		expect(result.success).toBe(true);
	});

	test("validates reviewWorkflowEnabled boolean", () => {
		const withTrue = { reviewWorkflowEnabled: true };
		const withFalse = { reviewWorkflowEnabled: false };

		expect(mapflowUserStatusSchema.safeParse(withTrue).success).toBe(true);
		expect(mapflowUserStatusSchema.safeParse(withFalse).success).toBe(true);
	});

	test("rejects non-boolean reviewWorkflowEnabled", () => {
		const invalidData = { reviewWorkflowEnabled: "yes" };
		const result = mapflowUserStatusSchema.safeParse(invalidData);
		expect(result.success).toBe(false);
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

describe("mapflowDataProviderPriceSchema", () => {
	test("validates complete price object", () => {
		const validPrice = {
			zoom: 18,
			priceSqKm: 0.5,
		};

		const result = mapflowDataProviderPriceSchema.safeParse(validPrice);
		expect(result.success).toBe(true);
	});

	test("validates empty object (all fields optional)", () => {
		const result = mapflowDataProviderPriceSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	test("allows extra fields via catchall", () => {
		const dataWithExtras = {
			zoom: 18,
			unknownField: "value",
		};

		const result = mapflowDataProviderPriceSchema.safeParse(dataWithExtras);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.unknownField).toBe("value");
		}
	});
});

describe("mapflowDataProviderSchema", () => {
	test("validates complete data provider", () => {
		const validProvider = {
			id: "550e8400-e29b-41d4-a716-446655440000",
			name: "maxar",
			displayName: "Maxar SecureWatch",
			previewUrl: "https://example.com/tiles/{z}/{x}/{y}",
			previewUrlMaxZoom: 18,
			price: [
				{ zoom: 17, priceSqKm: 0.3 },
				{ zoom: 18, priceSqKm: 0.5 },
			],
		};

		const result = mapflowDataProviderSchema.safeParse(validProvider);
		expect(result.success).toBe(true);
	});

	test("validates empty object (all fields optional)", () => {
		const result = mapflowDataProviderSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	test("rejects invalid uuid for id", () => {
		const invalidProvider = {
			id: "not-a-uuid",
		};

		const result = mapflowDataProviderSchema.safeParse(invalidProvider);
		expect(result.success).toBe(false);
	});

	test("allows extra fields via catchall", () => {
		const dataWithExtras = {
			name: "provider",
			customField: true,
		};

		const result = mapflowDataProviderSchema.safeParse(dataWithExtras);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.customField).toBe(true);
		}
	});
});
