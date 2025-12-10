import type * as z from "zod";
import { mapflowUserStatusSchema } from "./schemas.js";

const baseUrl = "https://api.mapflow.ai";
const userStatusCacheTtlMs = 300_000;

export type UserStatus = z.infer<typeof mapflowUserStatusSchema>;

export type MapflowClient = {
	request: (path: string, init?: RequestInit) => Promise<Response>;
	requestJson: <T>(
		path: string,
		schema: z.ZodType<T>,
		init?: RequestInit,
	) => Promise<T>;
	fetchUserStatus: () => Promise<UserStatus>;
	getCachedUserStatus: () => Promise<UserStatus>;
};

export function getMapflowToken() {
	const token = Bun.env?.MAPFLOW_TOKEN ?? process.env.MAPFLOW_TOKEN;
	if (!token) {
		throw new Error(
			"Mapflow API token is required. Please set MAPFLOW_TOKEN environment variable.",
		);
	}
	return token;
}

export function createMapflowClient(): MapflowClient {
	let userStatusCache: { data: UserStatus; expiresAt: number } | null = null;

	const withAuthHeaders = (init?: RequestInit) => {
		const token = getMapflowToken();
		return {
			Authorization: `Basic ${token}`,
			Accept: "application/json",
			...init?.headers,
		};
	};

	const request = async (path: string, init?: RequestInit) => {
		const url = new URL(path, baseUrl);
		const headers = withAuthHeaders(init);

		const response = await fetch(url, {
			...init,
			headers,
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Mapflow API request failed: ${response.status} ${response.statusText}${
					body ? ` - ${body}` : ""
				}`,
			);
		}

		return response;
	};

	const requestJson = async <T>(
		path: string,
		schema: z.ZodType<T>,
		init?: RequestInit,
	) => {
		const response = await request(path, init);
		const rawBody = await response.text();
		return schema.parse(rawBody ? JSON.parse(rawBody) : null);
	};

	const fetchUserStatus = async (): Promise<UserStatus> => {
		return requestJson("/rest/user/status", mapflowUserStatusSchema);
	};

	const getCachedUserStatus = async (): Promise<UserStatus> => {
		const now = Date.now();
		if (userStatusCache && userStatusCache.expiresAt > now) {
			return userStatusCache.data;
		}

		const fresh = await fetchUserStatus();
		userStatusCache = {
			data: fresh,
			expiresAt: now + userStatusCacheTtlMs,
		};
		return fresh;
	};

	return {
		request,
		requestJson,
		fetchUserStatus,
		getCachedUserStatus,
	};
}
