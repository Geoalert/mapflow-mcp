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
function unknownWriteOutcome(path: string, init?: RequestInit) {
	if (init?.method !== "POST") return undefined;
	if (path === "/rest/processings/v2")
		return "Processing request outcome is unknown. Check list-processings before retrying; do not automatically repeat the charge.";
	if (path === "/rest/projects")
		return "Project creation outcome is unknown. Check list-projects for the requested name before retrying; do not automatically create a duplicate.";
	return undefined;
}
export type ApiCredentials = string | { scheme: "Bearer"; token: string };
export function createTransport(credentials: ApiCredentials) {
	const authorization =
		typeof credentials === "string"
			? `Basic ${credentials}`
			: `Bearer ${credentials.token}`;
	const request = async (path: string, init?: RequestInit) => {
		const unknownOutcome = unknownWriteOutcome(path, init);
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
				unknownOutcome ?? "Mapflow API network error or timeout",
				"NETWORK_ERROR",
			);
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new ApiError(
				`Mapflow API request failed: ${response.status}${unknownOutcome && response.status >= 500 ? `. ${unknownOutcome}` : ""}`,
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
		const unknownOutcome = unknownWriteOutcome(path, init);
		let data: unknown;
		try {
			data = await response.json();
		} catch {
			throw new ApiError(
				unknownOutcome ?? "Mapflow API returned invalid JSON",
				"INVALID_RESPONSE",
			);
		}
		const parsed = schema.safeParse(data);
		if (!parsed.success)
			throw new ApiError(
				unknownOutcome ?? "Mapflow API returned an unexpected response shape",
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
