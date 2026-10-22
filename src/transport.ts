import type * as z from "zod";
export class ApiError extends Error {
	constructor(
		message: string,
		public readonly code = "API_ERROR",
	) {
		super(message);
	}
}
export type ApiTransport = ReturnType<typeof createTransport>;
const unknownOutcome =
	"Processing request outcome is unknown. Check list-processings before retrying; do not automatically repeat the charge.";
export type ApiCredentials = string | { scheme: "Bearer"; token: string };
export function createTransport(credentials: ApiCredentials) {
	const authorization =
		typeof credentials === "string"
			? `Basic ${credentials}`
			: `Bearer ${credentials.token}`;
	const request = async (path: string, init?: RequestInit) => {
		const base =
			Bun.env.MAPFLOW_BASE_URL ?? "https://whitemaps-staging.mapflow.ai";
		const url = new URL(path, base);
		if (url.origin !== new URL(base).origin)
			throw new ApiError("Cross-origin API request is not allowed");
		let response: Response;
		try {
			response = await fetch(url, {
				...init,
				redirect: "error",
				signal: AbortSignal.timeout(30_000),
				headers: {
					Accept: "application/json",
					...init?.headers,
					Authorization: authorization,
				},
			});
		} catch {
			throw new ApiError(
				init?.method === "POST" && path === "/rest/processings/v2"
					? unknownOutcome
					: "Mapflow API network error or timeout",
				"NETWORK_ERROR",
			);
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new ApiError(
				`Mapflow API request failed: ${response.status}${init?.method === "POST" && path === "/rest/processings/v2" && response.status >= 500 ? `. ${unknownOutcome}` : ""}`,
				`HTTP_${response.status}`,
			);
		}
		return response;
	};
	const requestJson = async <T>(
		path: string,
		schema: z.ZodType<T>,
		init?: RequestInit,
	): Promise<T> => {
		const response = await request(path, init);
		const isLaunch = init?.method === "POST" && path === "/rest/processings/v2";
		let data: unknown;
		try {
			data = await response.json();
		} catch {
			throw new ApiError(
				isLaunch ? unknownOutcome : "Mapflow API returned invalid JSON",
				"INVALID_RESPONSE",
			);
		}
		const parsed = schema.safeParse(data);
		if (!parsed.success)
			throw new ApiError(
				isLaunch
					? unknownOutcome
					: "Mapflow API returned an unexpected response shape",
				"INVALID_RESPONSE",
			);
		return parsed.data;
	};
	const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
		requestJson(path, schema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	return { request, requestJson, post };
}
