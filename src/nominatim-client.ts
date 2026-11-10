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
	searchBoundary: (
		query: string,
		allowPoint?: boolean,
	) => Promise<NominatimResult | null>;
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
		allowPoint = false,
	): Promise<NominatimResult | null> =>
		observe("api.completed", { service: "nominatim" }, async (setStatus) => {
			const turn = nextRequest.then(rateLimit);
			nextRequest = turn.catch(() => {});
			await turn;

			const url = new URL("/search", baseUrl);
			url.searchParams.set("q", query);
			url.searchParams.set("format", "json");
			url.searchParams.set("polygon_geojson", "1");
			url.searchParams.set("limit", "5");
			url.searchParams.set("addressdetails", "1");

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

			const first = results[0];
			if (
				first &&
				!allowPoint &&
				first.geojson?.type !== "Polygon" &&
				first.geojson?.type !== "MultiPolygon"
			) {
				const address = first.address;
				const district =
					address && typeof address === "object" && "state_district" in address
						? address.state_district
						: undefined;
				const country =
					address && typeof address === "object" && "country" in address
						? address.country
						: undefined;
				const suggestedQuery =
					typeof district === "string" && typeof country === "string"
						? `${district}, ${country}`
						: undefined;
				if (results.length > 1 || suggestedQuery) {
					const candidates = results.map((place) => ({
						displayName: place.display_name,
						osmType: place.osm_type,
						osmId: place.osm_id,
						geometryType: place.geojson?.type,
						placeType: place.addresstype,
					}));
					throw new ApiError(
						`The best match is a point or line, not an area boundary. Choose the intended place and repeat get-geoboundary with a more specific query, or provide bufferMeters explicitly for the point. Region or district boundaries may cover a different area than the city. ${JSON.stringify({ candidates, suggestedBoundaryQuery: suggestedQuery })}`,
						"PLACE_SELECTION_REQUIRED",
					);
				}
			}
			return first ?? null;
		});

	return {
		searchBoundary,
	};
}
