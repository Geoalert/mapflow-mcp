import area from "@turf/area";
import bbox from "@turf/bbox";
import booleanValid from "@turf/boolean-valid";
import buffer from "@turf/buffer";
import kinks from "@turf/kinks";
import { parse } from "wellknown";
import * as z from "zod";

const position = z.tuple([
	z.number().min(-180).max(180),
	z.number().min(-90).max(90),
]);
const line = z.array(position).min(2);
const ring = z
	.array(position)
	.min(4)
	.refine((p) => {
		const first = p[0];
		const last = p.at(-1);
		return first?.[0] === last?.[0] && first?.[1] === last?.[1];
	}, "Polygon rings must be closed");
const polygon = z.array(ring).min(1);
// GeoJSON inputs are WGS84; do not silently discard a legacy projected CRS.
const crs = z.never().optional();
export const aoiSchema = z
	.discriminatedUnion("type", [
		z.object({ crs, type: z.literal("Polygon"), coordinates: polygon }),
		z.object({
			crs,
			type: z.literal("MultiPolygon"),
			coordinates: z.array(polygon).min(1),
		}),
	])
	.refine(
		(g) => booleanValid(g) && kinks(g).features.length === 0 && area(g) > 0,
		"AOI must be a valid nonempty polygon without self-intersections",
	);
export const geometrySchema = z.union([
	aoiSchema,
	z.object({ crs, type: z.literal("Point"), coordinates: position }),
	z.object({
		crs,
		type: z.literal("MultiPoint"),
		coordinates: z.array(position).min(1),
	}),
	z.object({ crs, type: z.literal("LineString"), coordinates: line }),
	z.object({
		crs,
		type: z.literal("MultiLineString"),
		coordinates: z.array(line).min(1),
	}),
]);
export function geometryDetails(value: unknown) {
	const geometry = aoiSchema.parse(value);
	const areaM2 = area(geometry);
	return {
		geometry,
		bbox: bbox(geometry),
		areaM2,
		areaKm2: areaM2 / 1_000_000,
	};
}
export function bufferGeometry(value: unknown, meters: number) {
	const geometry = geometrySchema.parse(value);
	const distance = z.number().positive().parse(meters);
	const result = buffer(geometry, distance, { units: "meters" });
	if (!result) throw new Error("Buffer produced no polygon");
	return { ...geometryDetails(result.geometry), appliedBufferMeters: distance };
}
export function parseFootprint(footprint: string) {
	try {
		const srid = /^\s*SRID=(\d+);/i.exec(footprint);
		if (srid && srid[1] !== "4326") throw new Error("Footprint must use WGS84");
		const wkt = footprint.replace(/^\s*SRID=4326;/i, "");
		const value: unknown = footprint.trim().startsWith("{")
			? JSON.parse(footprint)
			: parse(wkt);
		return { ...geometryDetails(value), warnings: [] as string[] };
	} catch {
		return {
			geometry: null,
			bbox: null,
			areaM2: null,
			areaKm2: null,
			warnings: [
				"Mosaic footprint is empty or invalid; supply a valid AOI explicitly.",
			],
		};
	}
}
