import type * as z from "zod";
import {
	nominatimResultSchema,
	nominatimSearchResponseSchema,
} from "./schemas.js";

const baseUrl = "https://nominatim.openstreetmap.org";
const userAgent = "mapflow-mcp/0.1.0";
const minRequestIntervalMs = 1000;
const cacheDir = ".cache/nominatim";

export type NominatimResult = z.infer<typeof nominatimResultSchema>;

export type NominatimClient = {
	searchBoundary: (query: string) => Promise<NominatimResult | null>;
	clearCache: () => Promise<void>;
};

function sanitizeFilename(query: string): string {
	return query
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 100);
}

async function ensureCacheDir(): Promise<void> {
	const dir = Bun.file(cacheDir);
	if (!(await dir.exists())) {
		await Bun.write(`${cacheDir}/.gitkeep`, "");
	}
}

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

	const getCachePath = (query: string): string => {
		const filename = sanitizeFilename(query);
		return `${cacheDir}/${filename}.json`;
	};

	const readFromCache = async (
		query: string,
	): Promise<NominatimResult | null> => {
		const cachePath = getCachePath(query);
		const file = Bun.file(cachePath);
		if (await file.exists()) {
			const data = await file.json();
			return nominatimResultSchema.parse(data);
		}
		return null;
	};

	const writeToCache = async (
		query: string,
		result: NominatimResult,
	): Promise<void> => {
		await ensureCacheDir();
		const cachePath = getCachePath(query);
		await Bun.write(cachePath, JSON.stringify(result, null, 2));
	};

	const searchBoundary = async (
		query: string,
	): Promise<NominatimResult | null> => {
		// Check cache first
		const cached = await readFromCache(query);
		if (cached) {
			console.error(`[nominatim] Cache hit for: ${query}`);
			return cached;
		}

		// Rate limit before making request
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

		const result = results[0];
		if (!result) {
			return null;
		}

		// Cache the result
		await writeToCache(query, result);

		return result;
	};

	const clearCache = async (): Promise<void> => {
		const { readdir, unlink } = await import("node:fs/promises");
		const { join } = await import("node:path");

		try {
			const files = await readdir(cacheDir);
			for (const file of files) {
				if (file.endsWith(".json")) {
					await unlink(join(cacheDir, file));
				}
			}
			console.error("[nominatim] Cache cleared");
		} catch (_error) {
			// Cache directory might not exist
			console.error("[nominatim] No cache to clear");
		}
	};

	return {
		searchBoundary,
		clearCache,
	};
}
