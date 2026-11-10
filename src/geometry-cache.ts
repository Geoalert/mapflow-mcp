import { createHash } from "node:crypto";
import type * as z from "zod";
import type { aoiSchema } from "./geometry.js";
import { ApiError } from "./transport.js";

type Geometry = z.infer<typeof aoiSchema>;
type Entry = { owner: string; json: string; bytes: number; expiresAt: number };

export function geometryOwner(identity: string): string {
	return createHash("sha256").update(identity).digest("hex");
}

// Store serialized geometry to bound retained payload bytes and prevent mutation.
export class GeometryCache {
	private readonly entries = new Map<string, Entry>();
	private bytes = 0;
	private readonly ttlMs: number;
	private readonly maxBytes: number;
	private readonly maxEntries: number;
	private readonly now: () => number;

	constructor(
		options: {
			ttlMs?: number;
			maxBytes?: number;
			maxEntries?: number;
			now?: () => number;
		} = {},
	) {
		this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
		this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
		this.maxEntries = options.maxEntries ?? 1000;
		this.now = options.now ?? Date.now;
		for (const limit of [this.ttlMs, this.maxBytes, this.maxEntries]) {
			if (!Number.isSafeInteger(limit) || limit <= 0)
				throw new Error("Geometry cache limits must be positive safe integers");
		}
	}

	private remove(id: string) {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.bytes -= entry.bytes;
		this.entries.delete(id);
	}

	private prune() {
		const now = this.now();
		for (const [id, entry] of this.entries) {
			if (entry.expiresAt <= now) this.remove(id);
		}
	}

	put(owner: string, geometry: Geometry) {
		const json = JSON.stringify(geometry);
		const bytes = Buffer.byteLength(json, "utf8");
		if (bytes > this.maxBytes)
			throw new ApiError(
				"Geometry exceeds the in-memory cache limit. Use direct GeoJSON input or a smaller AOI.",
				"GEOMETRY_TOO_LARGE",
			);
		this.prune();
		while (
			this.entries.size >= this.maxEntries ||
			this.bytes + bytes > this.maxBytes
		) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.remove(oldest);
		}
		const geometryId = crypto.randomUUID();
		const expiresAt = this.now() + this.ttlMs;
		this.entries.set(geometryId, { owner, json, bytes, expiresAt });
		this.bytes += bytes;
		return { geometryId, expiresAt: new Date(expiresAt).toISOString() };
	}

	get(owner: string, id: string): Geometry {
		this.prune();
		const entry = this.entries.get(id);
		if (!entry || entry.owner !== owner)
			throw new ApiError(
				"Geometry is unavailable or expired. Repeat the original geoboundary, mosaic or catalog lookup (and any buffers), or supply GeoJSON again. Recalculate cost and obtain confirmation before start-processing.",
				"GEOMETRY_EXPIRED",
			);
		entry.expiresAt = this.now() + this.ttlMs;
		this.entries.delete(id);
		this.entries.set(id, entry);
		return JSON.parse(entry.json) as Geometry;
	}
}
