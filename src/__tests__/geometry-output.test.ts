import { expect, test } from "bun:test";
import { GeometryCache } from "../geometry-cache.js";
import {
	createGeometryOutput,
	outputBytes,
	vertexCount,
} from "../geometry-output.js";
import { presentImage } from "../geometry-presentation.js";
import { geometry, image } from "./fixtures.js";

function circle(n: number) {
	const ring: [number, number][] = Array.from({ length: n }, (_, i) => [
		Math.cos((2 * Math.PI * i) / n),
		Math.sin((2 * Math.PI * i) / n),
	]);
	ring.push([1, 0]);
	return { type: "Polygon" as const, coordinates: [ring] };
}

test("all footprints and preview parts are compact by default and retain exact cached data", () => {
	const cache = new GeometryCache();
	const presenter = createGeometryOutput(cache, "user", {});
	const dense = circle(1200);
	const result = presenter.finish(
		presentImage(
			{
				...image,
				footprint: dense,
				previews: [{ url: "https://example.com", geometry: dense }],
			},
			presenter,
		),
	);
	expect(JSON.stringify(result)).not.toContain('"coordinates"');
	const summary = result.footprintSummary as {
		geometryId: string;
		vertexCount: number;
	};
	expect(summary.vertexCount).toBe(1201);
	expect(cache.get("user", summary.geometryId)).toEqual(dense);
	expect(outputBytes(result)).toBeLessThan(32768);
});

test("simplified contours fit vertex budget without changing cached processing geometry", () => {
	const cache = new GeometryCache();
	const presenter = createGeometryOutput(cache, "user", {
		geometryMode: "simplified",
		maxVertices: 32,
	});
	const dense = circle(1000);
	const value = presenter.present(dense);
	if (!value) throw new Error("Missing contour");
	const result: Record<string, unknown> = { summary: value.summary };
	presenter.attach(result, "geometry", value);
	const finished = presenter.finish(result);
	expect(value.summary.geometryRepresentation).toBe("simplified");
	expect(vertexCount(value.display?.coordinates)).toBeLessThanOrEqual(32);
	expect(cache.get("user", value.summary.geometryId)).toEqual(dense);
	expect(outputBytes(finished)).toBeLessThan(32768);
});

test("full and legacy alias require explicit budget and include a context warning", () => {
	for (const options of [
		{ geometryMode: "full" as const },
		{ includeGeometry: true },
	]) {
		const presenter = createGeometryOutput(
			new GeometryCache(),
			"user",
			options,
		);
		const result = presenter.finish(presentImage(image, presenter));
		expect(JSON.stringify(result)).not.toContain('"coordinates"');
		expect(result.geometryWarnings.join()).toContain("maxOutputBytes");
	}
	const presenter = createGeometryOutput(new GeometryCache(), "user", {
		geometryMode: "full",
		maxOutputBytes: 32768,
	});
	const result = presenter.finish(presentImage(image, presenter));
	expect(result.footprint).toEqual(geometry);
	expect(result.geometryWarnings.join()).toContain("consume LLM context");
});

test("oversized full image removes root footprint as well as nested preview coordinates", () => {
	const presenter = createGeometryOutput(new GeometryCache(), "user", {
		geometryMode: "full",
		maxOutputBytes: 8000,
	});
	const dense = circle(1000);
	const result = presenter.finish(
		presentImage(
			{
				...image,
				footprint: dense,
				previews: [{ url: "https://example.com", geometry: dense }],
			},
			presenter,
		),
	);
	expect(result.requiredOutputBytes).toBeGreaterThan(8000);
	expect(JSON.stringify(result)).not.toContain('"coordinates"');
	expect(outputBytes(result)).toBeLessThanOrEqual(8000);
});

test("whole catalog budget covers all parts and both MCP payload copies", () => {
	const presenter = createGeometryOutput(new GeometryCache(), "user", {
		geometryMode: "full",
		maxOutputBytes: 12000,
	});
	const dense = circle(50);
	const items = Array.from({ length: 4 }, () =>
		presentImage({ ...image, footprint: dense }, presenter),
	);
	const result = presenter.finish({ items });
	expect(result.requiredOutputBytes).toBeGreaterThan(12000);
	expect(JSON.stringify(result)).not.toContain('"coordinates"');
	expect(outputBytes(result)).toBeLessThanOrEqual(12000);
});

test("unsafe hole simplification and invalid geometry fall back without exposing coordinates", () => {
	const presenter = createGeometryOutput(new GeometryCache(), "user", {
		geometryMode: "simplified",
		maxVertices: 4,
	});
	const outer = circle(100).coordinates[0];
	const hole = circle(20).coordinates[0]?.map(([x, y]) => [x / 2, y / 2]);
	const value = presenter.present({
		type: "Polygon",
		coordinates: [outer, hole],
	});
	expect(value?.display).toBeUndefined();
	expect(presenter.present({ type: "Polygon", coordinates: [] })).toBeNull();
	expect(presenter.finish({}).geometryWarnings.length).toBeGreaterThan(0);
});
