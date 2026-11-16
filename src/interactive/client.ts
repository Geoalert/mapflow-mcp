// Mapflow Interactive's app, as its tools call it: one route of `/api/agent/v2` per tool (tools.ts' ROUTES), as the
// same user this server calls Mapflow as.

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { currentLogContext, observe } from "../logging.js";
import { type ApiCredentials, ApiError } from "../transport.js";
import type { InteractiveConfig } from "./config.js";
import type { Route } from "./tools.js";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The app's answer: the tool's JSON (`next` as a step), its pictures, what the card shows, the prose that follows. */
export type Envelope = {
	result: Record<string, unknown>;
	pictures: { mimeType: string; data: string }[];
	card: Record<string, unknown> | null;
	steps: string | null;
	pictureUrl?: string;
};

/** A tool's refusal by the app (its message is what the model reads), as distinct from the call failing. */
export class Refusal extends ApiError {}

/** This server's name and version, which the app keeps with each call (X-Interactive-Toolset). */
export const TOOLSET = "mapflow-mcp interactive-v2";

const authorization = (credentials: ApiCredentials) =>
	typeof credentials === "string"
		? `Basic ${credentials}`
		: `Bearer ${credentials.token}`;

/** The route's address with the call's path arguments in it, and the rest: the query of a GET, else the body. */
export function addressOf(
	baseUrl: string,
	route: Route,
	args: Record<string, unknown>,
) {
	const rest: Record<string, unknown> = { ...args };
	const path = route.path.replace(/\{(\w+)\}/g, (_, key: string) => {
		const value = rest[key] ?? (key === "run" ? "latest" : undefined);
		delete rest[key];
		if (value === undefined || value === null || value === "")
			throw new ApiError(`${key} is required`, "INVALID_ARGUMENT");
		return encodeURIComponent(String(value));
	});
	const url = new URL(`${baseUrl}${path}`);
	if (url.origin !== new URL(baseUrl).origin)
		throw new ApiError("Cross-origin request is not allowed");
	for (const key of Object.keys(rest))
		if (rest[key] === undefined) delete rest[key];
	if (route.method === "GET") {
		for (const [key, value] of Object.entries(rest)) {
			if (value === null) continue;
			for (const item of Array.isArray(value) ? value : [value])
				url.searchParams.append(key, String(item));
		}
		return { url, body: undefined };
	}
	return { url, body: JSON.stringify(rest) };
}

const message = async (response: Response) => {
	try {
		const body = (await response.json()) as { message?: unknown };
		return typeof body?.message === "string" ? body.message : undefined;
	} catch {
		return undefined;
	}
};

export async function callApp(
	config: InteractiveConfig,
	route: Route,
	args: Record<string, unknown>,
	credentials: ApiCredentials,
	extra: Extra,
): Promise<Envelope> {
	const { url, body } = addressOf(config.baseUrl, route, args);
	const userAgent = extra.requestInfo?.headers["user-agent"];
	return observe(
		"api.completed",
		{ service: "interactive" },
		async (setStatus) => {
			let response: Response;
			try {
				response = await fetch(url, {
					method: route.method,
					body,
					redirect: "error",
					signal: AbortSignal.timeout(config.timeoutMs),
					headers: {
						Accept: "application/json",
						...(body !== undefined
							? { "Content-Type": "application/json" }
							: {}),
						Authorization: authorization(credentials),
						"X-Request-Id": currentLogContext()?.requestId ?? "",
						"X-Interactive-Toolset": TOOLSET,
						...(typeof userAgent === "string"
							? { "X-Interactive-Client": userAgent.slice(0, 200) }
							: {}),
					},
				});
			} catch (error) {
				throw error instanceof Error && error.name === "TimeoutError"
					? new ApiError(
							`Mapflow Interactive didn't answer within ${Math.round(config.timeoutMs / 1000)} s; a run goes on there: call wait for it`,
							"TIMEOUT",
						)
					: new ApiError("Mapflow Interactive network error", "NETWORK_ERROR");
			}
			setStatus(response.status);
			if (!response.ok) {
				const said = await message(response);
				if (response.status === 401)
					throw new ApiError(
						"Mapflow Interactive refused the sign-in",
						"AUTH_REJECTED",
					);
				if (response.status === 429 || response.status === 503) {
					const after = response.headers.get("retry-after");
					throw new ApiError(
						said ??
							`Mapflow Interactive is busy${after ? `; try again in ${after} s` : "; try again shortly"}`,
						"BUSY",
					);
				}
				if (said) throw new Refusal(said, `HTTP_${response.status}`);
				throw new ApiError(
					`Mapflow Interactive answered ${response.status}`,
					`HTTP_${response.status}`,
				);
			}
			let answer: Envelope;
			try {
				answer = (await response.json()) as Envelope;
			} catch {
				throw new ApiError(
					"Mapflow Interactive returned invalid JSON",
					"INVALID_RESPONSE",
				);
			}
			if (
				!answer ||
				typeof answer.result !== "object" ||
				!Array.isArray(answer.pictures)
			)
				throw new ApiError(
					"Mapflow Interactive returned an unexpected answer",
					"INVALID_RESPONSE",
				);
			return answer;
		},
	);
}
