import simplify from "@turf/simplify";
import * as z from "zod";
import { geometryDetailsSchema } from "./api-schemas.js";
import { aoiSchema, geometryDetails } from "./geometry.js";
import type { GeometryCache } from "./geometry-cache.js";
import { ApiError } from "./transport.js";

export const DEFAULT_OUTPUT_BYTES = 32 * 1024;
export const MAX_OUTPUT_BYTES = 256 * 1024;
export const geometryOutputFields = {
	geometryMode: z
		.enum(["summary", "simplified", "full"])
		.optional()
		.describe(
			"Summary by default. Simplified is for display only. Full coordinates consume context and require an explicit maxOutputBytes budget.",
		),
	includeGeometry: z
		.boolean()
		.optional()
		.describe(
			"Deprecated alias for geometryMode=full. Still requires maxOutputBytes; cannot be combined with geometryMode.",
		),
	maxOutputBytes: z
		.number()
		.int()
		.min(1024)
		.max(MAX_OUTPUT_BYTES)
		.optional()
		.describe(
			"Explicit byte budget for the entire MCP result, including text and structured copies. Full output requires this acknowledgement.",
		),
	maxVertices: z
		.number()
		.int()
		.min(4)
		.max(1000)
		.default(200)
		.describe(
			"Maximum vertices per simplified contour; response byte limit also applies.",
		),
};
export type GeometryOutputOptions = {
	geometryMode?: "summary" | "simplified" | "full";
	includeGeometry?: boolean;
	maxOutputBytes?: number;
	maxVertices?: number;
};
export const geometrySummarySchema = geometryDetailsSchema
	.omit({ geometry: true })
	.extend({
		geometryId: z.uuid(),
		expiresAt: z.iso.datetime(),
		vertexCount: z.number().int(),
		fullGeometryBytes: z.number().int(),
		geometryIncluded: z.boolean(),
		geometryRepresentation: z.enum(["summary", "simplified", "full"]),
		returnedVertexCount: z.number().int(),
	});
export const outputNoticeFields = {
	geometryWarnings: z.array(z.string()),
	requiredOutputBytes: z.number().int().optional(),
};
export const cachedGeometryOutputSchema = geometrySummarySchema.extend({
	geometry: aoiSchema.optional(),
	...outputNoticeFields,
});
export function splitGeometryOutput<T extends GeometryOutputOptions>(args: T) {
	const {
		geometryMode,
		includeGeometry,
		maxOutputBytes,
		maxVertices,
		...input
	} = args;
	if (geometryMode !== undefined && includeGeometry !== undefined)
		throw new ApiError(
			"Use geometryMode or includeGeometry, never both",
			"INVALID_GEOMETRY_OUTPUT",
		);
	return {
		input,
		options: { geometryMode, includeGeometry, maxOutputBytes, maxVertices },
	};
}
export function vertexCount(value: unknown): number {
	if (!Array.isArray(value)) return 0;
	if (typeof value[0] === "number") return 1;
	return value.reduce(
		(sum: number, child: unknown) => sum + vertexCount(child),
		0,
	);
}
export function outputBytes(value: unknown) {
	return Buffer.byteLength(
		JSON.stringify({
			content: [{ type: "text", text: JSON.stringify(value) }],
			structuredContent: value,
		}),
		"utf8",
	);
}

type Geometry = z.infer<typeof aoiSchema>;
function overview(
	geometry: Geometry,
	maxVertices: number,
): Geometry | undefined {
	if (vertexCount(geometry.coordinates) <= maxVertices) return geometry;
	// Independent ring simplification can move a boundary across a hole. Keep
	// such shapes exact only when they already fit, otherwise return a summary.
	const polygons =
		geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
	if (polygons.some((rings) => rings.length > 1)) return;
	for (let tolerance = 0.000001; tolerance <= 1; tolerance *= 4) {
		try {
			const candidate = simplify(geometry, {
				tolerance,
				highQuality: false,
				mutate: false,
			});
			if (vertexCount(candidate.coordinates) > maxVertices) continue;
			const checked = aoiSchema.safeParse(candidate);
			if (checked.success) return checked.data;
		} catch {
			return;
		}
	}
}

// One presenter per response, including every catalog image and preview part.
export function createGeometryOutput(
	cache: GeometryCache,
	owner: string,
	options: GeometryOutputOptions,
) {
	const mode =
		options.geometryMode ?? (options.includeGeometry ? "full" : "summary");
	const warnings: string[] = [];
	const rendered: {
		object: Record<string, unknown>;
		key: string;
		summary: z.infer<typeof geometrySummarySchema>;
	}[] = [];
	const budget =
		mode === "full"
			? (options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES)
			: Math.min(
					options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES,
					DEFAULT_OUTPUT_BYTES,
				);
	if (mode === "full")
		warnings.push(
			"Full coordinates consume LLM context. Prefer geometryId for processing or simplified contours for display. Explicit maxOutputBytes is required to include full geometry.",
		);
	if (mode === "simplified")
		warnings.push(
			"Simplified contours are for display only. Area and bbox describe the exact source; use geometryId for cost and processing.",
		);
	function present(value: unknown) {
		if (value == null) return null;
		const parsed = aoiSchema.safeParse(value);
		if (!parsed.success) {
			warnings.push(
				"An invalid or unsupported polygon was omitted; no geometryId is available for it.",
			);
			return null;
		}
		const { geometry, ...details } = geometryDetails(parsed.data);
		const summary: z.infer<typeof geometrySummarySchema> = {
			...details,
			...cache.put(owner, geometry),
			vertexCount: vertexCount(geometry.coordinates),
			fullGeometryBytes: Buffer.byteLength(JSON.stringify(geometry), "utf8"),
			geometryIncluded: false,
			geometryRepresentation: "summary",
			returnedVertexCount: 0,
		};
		const display =
			mode === "full" && options.maxOutputBytes !== undefined
				? geometry
				: mode === "simplified"
					? overview(geometry, options.maxVertices ?? 200)
					: undefined;
		if (mode === "simplified" && !display)
			warnings.push(
				"A contour could not be safely simplified within the vertex budget; returning its summary.",
			);
		return { summary, display };
	}
	function attach(
		target: Record<string, unknown>,
		key: string,
		value: ReturnType<typeof present>,
	) {
		if (!value) return;
		if (value.display) {
			target[key] = value.display;
			value.summary.geometryIncluded = true;
			value.summary.geometryRepresentation =
				mode === "full" ? "full" : "simplified";
			value.summary.returnedVertexCount = vertexCount(
				value.display.coordinates,
			);
		}
		rendered.push({ object: target, key, summary: value.summary });
	}
	function finish<T extends Record<string, unknown>>(data: T) {
		const result = {
			...data,
			geometryWarnings: [...new Set(warnings)],
		} as T & { geometryWarnings: string[]; requiredOutputBytes?: number };
		const required = outputBytes(result);
		if (required > budget) {
			for (const item of rendered) {
				delete item.object[item.key];
				if (item.object === data) delete result[item.key];
				item.summary.geometryIncluded = false;
				item.summary.geometryRepresentation = "summary";
				item.summary.returnedVertexCount = 0;
			}
			// Root summary may have been spread into data; update it too.
			if ("geometryRepresentation" in result)
				Object.assign(result, {
					geometryIncluded: false,
					geometryRepresentation: "summary",
					returnedVertexCount: 0,
				});
			delete result.geometry;
			result.requiredOutputBytes = required;
			result.geometryWarnings.push(
				`Requested output needs ${required} bytes, exceeding the ${budget}-byte budget. Coordinates omitted. Reduce the catalog page or explicitly request full with a sufficient maxOutputBytes (hard maximum ${MAX_OUTPUT_BYTES}).`,
			);
		}
		if (outputBytes(result) > budget)
			throw new ApiError(
				"Even the compact response exceeds the output budget. Reduce limit or request one image; maximum full output is 262144 bytes.",
				"GEOMETRY_OUTPUT_TOO_LARGE",
			);
		return result;
	}
	return { present, attach, finish };
}
