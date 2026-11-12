import * as z from "zod";
import { processingSchema } from "./api-schemas.js";
import { ApiError, type ApiTransport } from "./transport.js";

export const resultRequestSchema = z.strictObject({
	processingId: z.uuid(),
	variant: z.enum(["current", "original"]).default("current"),
	delivery: z.enum(["text", "resource"]).default("resource"),
	maxResultBytes: z
		.number()
		.int()
		.min(1)
		.max(5 * 1024 * 1024)
		.default(64 * 1024),
});
export const resultOutputSchema = z.object({
	processingId: z.uuid(),
	variant: z.enum(["current", "original"]),
	format: z.literal("geojson"),
	delivery: z.enum(["text", "resource"]),
	warnings: z.array(z.string()),
	fileName: z.string(),
	mimeType: z.literal("application/geo+json"),
	resourceUri: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	text: z.string(),
});
const geojson = z.object({
	type: z.literal("FeatureCollection"),
	features: z.array(
		z.object({
			type: z.literal("Feature"),
			geometry: z.object({ type: z.string() }).nullable(),
			properties: z.record(z.string(), z.unknown()).nullable(),
		}),
	),
});

export async function getProcessingResult(
	http: ApiTransport,
	args: z.input<typeof resultRequestSchema>,
) {
	const { processingId, variant, delivery, maxResultBytes } =
		resultRequestSchema.parse(args);
	// Keep a fresh user-scoped read even on deployments with guarded downloads.
	const processing = await http.requestJson(
		`/rest/processings/${processingId}/v2`,
		processingSchema,
	);
	if (processing.id !== processingId)
		throw new ApiError(
			"Mapflow returned a different processing",
			"INVALID_RESPONSE",
		);
	if (processing.status !== "OK")
		throw new ApiError(
			"Results are available only after the processing completes successfully.",
			"RESULT_NOT_READY",
		);
	const response = await http.request(
		`/rest/processings/${processingId}/result${variant === "original" ? "/original" : ""}`,
		{ headers: { Accept: "application/octet-stream" } },
	);
	const tooLarge = () =>
		new ApiError(
			`GeoJSON exceeds the requested ${maxResultBytes}-byte limit. Larger files consume more model context. Explicitly increase maxResultBytes (maximum 5242880) to retrieve the complete file, or download it in Mapflow. No partial GeoJSON is returned.`,
			"RESULT_TOO_LARGE",
		);
	if (Number(response.headers.get("Content-Length")) > maxResultBytes) {
		await response.body?.cancel();
		throw tooLarge();
	}
	if (!response.body)
		throw new ApiError("Empty result response", "INVALID_RESPONSE");
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let text = "";
	let sizeBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			sizeBytes += value.byteLength;
			if (sizeBytes > maxResultBytes) throw tooLarge();
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		geojson.parse(JSON.parse(text));
	} catch (error) {
		await reader.cancel().catch(() => {});
		if (error instanceof ApiError) throw error;
		throw new ApiError(
			"GeoJSON download was interrupted or returned an invalid FeatureCollection. Retry this read-only operation.",
			"INVALID_RESPONSE",
		);
	} finally {
		reader.releaseLock();
	}
	return {
		processingId,
		variant,
		delivery,
		warnings: [
			...(delivery === "text"
				? [
						"Text delivery consumes model context and may be truncated by the client. Prefer delivery=resource to save the GeoJSON file; use text only when required and verify completeness before saving.",
					]
				: []),
			...(sizeBytes > 64 * 1024
				? [
						"Large GeoJSON was explicitly requested and may consume substantial model context.",
					]
				: []),
		],
		format: "geojson" as const,
		fileName: `${processingId}-${variant}.geojson`,
		mimeType: "application/geo+json" as const,
		resourceUri: `mapflow://processings/${processingId}/result/${variant}.geojson`,
		sizeBytes,
		text,
	};
}
