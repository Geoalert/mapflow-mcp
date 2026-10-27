import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
	JSONRPCMessage,
	RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import {
	currentLogContext,
	elapsedMs,
	type LogContext,
	logEvent,
	withLogContext,
} from "./logging.js";

// Observe the public transport boundary so SDK input-validation failures are
// covered too. Requests, responses and client-supplied IDs never enter logs.
export function loggingTransport(
	inner: Transport,
	knownTools: Set<string>,
): Transport {
	const pending = new Map<RequestId, { context: LogContext; start: number }>();
	const finish = (
		id: RequestId | undefined,
		failed: boolean,
		fallback = "TOOL_ERROR",
	) => {
		if (id === undefined) return;
		const entry = pending.get(id);
		if (!entry) return;
		pending.delete(id);
		withLogContext(entry.context, () =>
			logEvent("tool.completed", {
				outcome: failed ? "error" : "success",
				durationMs: elapsedMs(entry.start),
				errorCode: failed ? (entry.context.errorCode ?? fallback) : undefined,
			}),
		);
	};
	const wrapper: Transport = {
		get sessionId() {
			return inner.sessionId;
		},
		setProtocolVersion(version) {
			inner.setProtocolVersion?.(version);
		},
		async start() {
			inner.onmessage = (message, extra) => {
				if (
					"method" in message &&
					message.method === "tools/call" &&
					"id" in message
				) {
					const name = message.params?.name;
					const value = {
						requestId: currentLogContext()?.requestId ?? crypto.randomUUID(),
						tool:
							typeof name === "string" && knownTools.has(name)
								? name
								: "unknown",
					};
					// Duplicate active IDs are invalid, but must not silently lose a span.
					finish(message.id, true, "DUPLICATE_REQUEST_ID");
					pending.set(message.id, { context: value, start: performance.now() });
					withLogContext(value, () => wrapper.onmessage?.(message, extra));
				} else wrapper.onmessage?.(message, extra);
			};
			inner.onerror = (error) => wrapper.onerror?.(error);
			inner.onclose = () => {
				for (const id of pending.keys()) finish(id, true, "TRANSPORT_CLOSED");
				wrapper.onclose?.();
			};
			await inner.start();
		},
		async send(message: JSONRPCMessage, options) {
			try {
				await inner.send(message, options);
			} catch (error) {
				if ("id" in message) finish(message.id, true, "TRANSPORT_ERROR");
				throw error;
			}
			if ("result" in message)
				finish(message.id, message.result.isError === true);
			else if ("error" in message) finish(message.id, true, "PROTOCOL_ERROR");
		},
		async close() {
			try {
				await inner.close();
			} finally {
				for (const id of pending.keys()) finish(id, true, "TRANSPORT_CLOSED");
			}
		},
	};
	return wrapper;
}
