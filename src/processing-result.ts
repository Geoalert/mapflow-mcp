import * as z from "zod";
import { processingSchema } from "./api-schemas.js";
import { ApiError, type ApiTransport } from "./transport.js";

export const resultRequestSchema = z.strictObject({
	processingId: z.uuid(),
	variant: z.enum(["current", "original"]).default("current"),
});
export const resultOutputSchema = z.object({
	processingId: z.uuid(),
	variant: z.enum(["current", "original"]),
	format: z.literal("geojson"),
	fileName: z.string(),
	mimeType: z.literal("application/geo+json"),
	resourceUri: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	text: z.string(),
});
const MAX_RESULT_BYTES = 5 * 1024 * 1024;
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
	const { processingId, variant } = resultRequestSchema.parse(args);
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
			"GeoJSON exceeds the 5 MiB MCP limit. Download the full result in Mapflow.",
			"RESULT_TOO_LARGE",
		);
	if (Number(response.headers.get("Content-Length")) > MAX_RESULT_BYTES) {
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
			if (sizeBytes > MAX_RESULT_BYTES) throw tooLarge();
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
		format: "geojson" as const,
		fileName: `${processingId}-${variant}.geojson`,
		mimeType: "application/geo+json" as const,
		resourceUri: `mapflow://processings/${processingId}/result/${variant}.geojson`,
		sizeBytes,
		text,
	};
}
