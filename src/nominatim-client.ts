import type * as z from "zod";
import {
	type nominatimResultSchema,
	nominatimSearchResponseSchema,
} from "./schemas.js";

const baseUrl = "https://nominatim.openstreetmap.org";
const userAgent = "mapflow-mcp/0.1.0";
const minRequestIntervalMs = 1000;

export type NominatimResult = z.infer<typeof nominatimResultSchema>;

export type NominatimClient = {
	searchBoundary: (query: string) => Promise<NominatimResult | null>;
};

export function createNominatimClient(): NominatimClient {
	let lastRequestTime = 0;

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
	): Promise<NominatimResult | null> => {
		await rateLimit();

		const url = new URL("/search", baseUrl);
		url.searchParams.set("q", query);
		url.searchParams.set("format", "json");
		url.searchParams.set("polygon_geojson", "1");
		url.searchParams.set("limit", "1");

		console.error(`[nominatim] Fetching: ${url.toString()}`);

		const response = await fetch(url, {
			headers: {
				"User-Agent": userAgent,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Nominatim API request failed: ${response.status} ${response.statusText}${
					body ? ` - ${body}` : ""
				}`,
			);
		}

		const rawBody = await response.text();
		const results = nominatimSearchResponseSchema.parse(
			rawBody ? JSON.parse(rawBody) : [],
		);

		return results[0] ?? null;
	};

	return {
		searchBoundary,
	};
}
