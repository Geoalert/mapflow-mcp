import { expect, test } from "bun:test";
import { GeometryCache } from "../geometry-cache.js";
import { geometry } from "./fixtures.js";

test("cache isolates owners, clones values and refreshes inactivity TTL", () => {
	let now = 0;
	const cache = new GeometryCache({ ttlMs: 100, now: () => now });
	const original = structuredClone(geometry);
	const { geometryId } = cache.put("alice", original);
	original.coordinates[0]?.push([1, 1]);
	expect(() => cache.get("bob", geometryId)).toThrow("unavailable or expired");
	expect(cache.get("alice", geometryId)).toEqual(geometry);
	const read = cache.get("alice", geometryId);
	read.coordinates.length = 0;
	now = 90;
	expect(cache.get("alice", geometryId)).toEqual(geometry);
	now = 180;
	expect(cache.get("alice", geometryId)).toEqual(geometry);
	now = 280;
	expect(() => cache.get("alice", geometryId)).toThrow("Recalculate cost");
});

test("cache evicts least recently used entries by count and payload bytes", () => {
	const bytes = Buffer.byteLength(JSON.stringify(geometry));
	for (const options of [{ maxEntries: 2 }, { maxBytes: bytes * 2 }]) {
		const cache = new GeometryCache(options);
		const a = cache.put("alice", geometry).geometryId;
		const b = cache.put("alice", geometry).geometryId;
		cache.get("alice", a);
		const c = cache.put("bob", geometry).geometryId;
		expect(() => cache.get("alice", b)).toThrow("unavailable or expired");
		expect(cache.get("alice", a)).toEqual(geometry);
		expect(cache.get("bob", c)).toEqual(geometry);
	}
});

test("oversized insertion preserves existing entries; restarted cache misses", () => {
	const cache = new GeometryCache({
		maxBytes: Buffer.byteLength(JSON.stringify(geometry)),
	});
	const { geometryId } = cache.put("alice", geometry);
	expect(() =>
		cache.put("alice", {
			type: "MultiPolygon",
			coordinates: [geometry.coordinates, geometry.coordinates],
		}),
	).toThrow("exceeds");
	expect(cache.get("alice", geometryId)).toEqual(geometry);
	expect(() => new GeometryCache().get("alice", geometryId)).toThrow(
		"unavailable or expired",
	);
});
