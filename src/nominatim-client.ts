import type * as z from "zod";
import { observe } from "./logging.js";
import {
	type nominatimResultSchema,
	nominatimSearchResponseSchema,
} from "./schemas.js";
import { ApiError } from "./transport.js";

const baseUrl = "https://nominatim.openstreetmap.org";
const userAgent = "mapflow-mcp/0.1.0";
const minRequestIntervalMs = 1000;

export type NominatimResult = z.infer<typeof nominatimResultSchema>;

export type NominatimClient = {
	searchBoundary: (query: string) => Promise<NominatimResult | null>;
};

export function createNominatimClient(): NominatimClient {
	let lastRequestTime = 0;
	let nextRequest = Promise.resolve();

	const rateLimit = async (): Promise<void> => {
		const now = Date.now();
		const elapsed = now - lastRequestTime;
		if (elapsed < minRequestIntervalMs) {
			const delay = minRequestIntervalMs - elapsed;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
		lastRequestTime = Date.now();
	};

	const searchBoundary = async (
		query: string,
	): Promise<NominatimResult | null> =>
		observe("api.completed", { service: "nominatim" }, async (setStatus) => {
			const turn = nextRequest.then(rateLimit);
			nextRequest = turn.catch(() => {});
			await turn;

			const url = new URL("/search", baseUrl);
			url.searchParams.set("q", query);
			url.searchParams.set("format", "json");
			url.searchParams.set("polygon_geojson", "1");
			url.searchParams.set("limit", "1");

			const response = await fetch(url, {
				signal: AbortSignal.timeout(30_000),
				headers: {
					"User-Agent": userAgent,
					Accept: "application/json",
				},
			});

			setStatus(response.status);
			if (!response.ok) {
				await response.body?.cancel();
				throw new ApiError(
					`Nominatim API request failed: ${response.status}`,
					`HTTP_${response.status}`,
				);
			}

			const rawBody = await response.text();
			const results = nominatimSearchResponseSchema.parse(
				rawBody ? JSON.parse(rawBody) : [],
			);

			return results[0] ?? null;
		});

	return {
		searchBoundary,
	};
}
