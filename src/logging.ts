import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";
import { ZodError } from "zod";

export type LogContext = {
	requestId: string;
	tool?: string;
	errorCode?: string;
};
const context = new AsyncLocalStorage<LogContext>();
const levels = new Set([
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
]);
const configuredLevel = process.env.LOG_LEVEL ?? "info";
const destination = pino.destination({ dest: 2, sync: true });
// Losing the log sink must not turn an already completed paid API operation
// into a failure that a caller might retry. No fallback may use stdout.
destination.on("error", () => {});
const logger = pino(
	{
		level: levels.has(configuredLevel) ? configuredLevel : "info",
		base: { service: "mapflow-mcp" },
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: { level: (level) => ({ level }) },
	},
	destination,
);

export function currentLogContext() {
	return context.getStore();
}
export function withLogContext<T>(value: LogContext, action: () => T): T {
	return context.run(value, action);
}
export function withRequestContext<T>(action: () => T): T {
	return withLogContext({ requestId: crypto.randomUUID() }, action);
}

const codes = new Set([
	"API_ERROR",
	"NETWORK_ERROR",
	"INVALID_RESPONSE",
	"AUTH_REQUIRED",
	"NOT_FOUND",
	"AMBIGUOUS_IMAGE",
	"INVALID_MODEL",
	"INVALID_PROVIDER",
	"MOSAIC_NOT_READY",
	"BUFFER_REQUIRED",
	"invalid_token",
	"insufficient_scope",
	"token_exchange_failed",
]);
// Never serialize errors: even names, stacks and validation paths can contain input.
export function safeErrorCode(error: unknown): string {
	if (error instanceof ZodError) return "VALIDATION_ERROR";
	if (error && typeof error === "object" && "code" in error) {
		const code = error.code;
		if (
			typeof code === "string" &&
			(codes.has(code) || /^HTTP_[1-5]\d{2}$/.test(code))
		)
			return code;
	}
	if (error instanceof SyntaxError) return "INVALID_JSON";
	if (error instanceof DOMException && error.name === "TimeoutError")
		return "TIMEOUT";
	if (error instanceof DOMException && error.name === "AbortError")
		return "ABORTED";
	return "INTERNAL_ERROR";
}
export function recordToolError(error: unknown) {
	const value = currentLogContext();
	if (value) value.errorCode = safeErrorCode(error);
}

type Event =
	| "server.started"
	| "server.failed"
	| "http.completed"
	| "tool.completed"
	| "api.completed"
	| "oauth.completed";
type Fields = {
	outcome: "success" | "error";
	durationMs?: number;
	status?: number;
	errorCode?: string;
	service?: "mapflow" | "nominatim";
	transport?: "http" | "stdio";
	route?: "mcp" | "oauth" | "metadata" | "other";
};
export function logEvent(event: Event, fields: Fields) {
	const active = currentLogContext();
	const level = fields.outcome === "error" ? "error" : "info";
	// Explicit projection also drops extra properties passed by untyped callers.
	try {
		logger[level]({
			event,
			requestId: active?.requestId,
			tool: active?.tool,
			outcome: fields.outcome,
			durationMs: fields.durationMs,
			status: fields.status,
			errorCode: fields.errorCode,
			upstream: fields.service,
			transport: fields.transport,
			route: fields.route,
		});
	} catch {
		// stderr is unavailable; preserve the operation's original result.
	}
}
export function elapsedMs(start: number) {
	return Math.round((performance.now() - start) * 100) / 100;
}

export async function observe<T>(
	event: "api.completed" | "oauth.completed",
	fields: Pick<Fields, "service">,
	action: (setStatus: (status: number) => void) => Promise<T>,
): Promise<T> {
	const run = async () => {
		const start = performance.now();
		let status: number | undefined;
		try {
			const result = await action((value) => {
				status = value;
			});
			logEvent(event, {
				...fields,
				outcome: "success",
				durationMs: elapsedMs(start),
				status,
			});
			return result;
		} catch (error) {
			logEvent(event, {
				...fields,
				outcome: "error",
				durationMs: elapsedMs(start),
				status,
				errorCode: safeErrorCode(error),
			});
			throw error;
		}
	};
	return currentLogContext() ? run() : withRequestContext(run);
}
