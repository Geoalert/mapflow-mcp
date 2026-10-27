import { createHttpHandler } from "../http-server.js";

// Isolate real stderr capture and concurrent requests from other fetch mocks.
process.env.MAPFLOW_BASE_URL = "https://api.example.test";
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
	const token = new Headers(init?.headers).get("Authorization");
	if (String(url).includes("nominatim")) return Response.json([]);
	if (token === "Basic PRIVATE_NETWORK")
		throw new Error("PRIVATE_NETWORK_DETAILS");
	if (token === "Basic PRIVATE_HTTP")
		return new Response("PRIVATE_RESPONSE_BODY", { status: 502 });
	if (token === "Basic PRIVATE_SHAPE")
		return Response.json({ remainingCredits: "PRIVATE_BAD_SHAPE" });
	await new Promise((resolve) =>
		setTimeout(resolve, token === "Basic PRIVATE_SLOW" ? 30 : 1),
	);
	return Response.json({ remainingCredits: 123456789 });
}) as typeof fetch;
const handle = createHttpHandler();
async function call(name: string, args: unknown, token = "PRIVATE_FAST") {
	const response = await handle(
		new Request("https://mcp.example.test/mcp?PRIVATE_QUERY", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${token}`,
				"X-Request-Id": "PRIVATE_CLIENT_REQUEST_ID",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: "PRIVATE_RPC_ID",
				method: "tools/call",
				params: { name, arguments: args },
			}),
		}),
	);
	const body = (await response.json()) as { result?: { isError?: boolean } };
	return {
		requestId: response.headers.get("X-Request-Id"),
		status: response.status,
		failed: body.result?.isError === true,
	};
}
const concurrent = await Promise.all([
	call("get-limits", {}, "PRIVATE_SLOW"),
	call("get-limits", {}, "PRIVATE_FAST"),
]);
const errors = [];
for (const token of ["PRIVATE_HTTP", "PRIVATE_NETWORK", "PRIVATE_SHAPE"])
	errors.push(await call("get-limits", {}, token));
const invalid = await call("get-project", {
	projectId: 123,
	PRIVATE_ARGUMENT: "PRIVATE_VALUE",
});
const unknown = await call("PRIVATE_TOOL_NAME", {});
const nominatim = await call("get-geoboundary", { query: "PRIVATE_SEARCH" });
const missing = await handle(
	new Request("https://mcp.example.test/PRIVATE_PATH?PRIVATE_QUERY"),
);
const oauth = createHttpHandler({
	issuer: "https://auth.example.test/realms/test",
	resource: "https://mcp.example.test/mcp/oauth",
	clientId: "PRIVATE_CLIENT",
	clientSecret: "PRIVATE_CLIENT_SECRET",
	audience: "mapflow",
	scope: "mapflow:mcp",
});
const unauthorized = await oauth(
	new Request("https://mcp.example.test/mcp/oauth"),
);
process.stdout.write(
	JSON.stringify({
		concurrent,
		errors,
		invalid,
		unknown,
		nominatim,
		missing: missing.status,
		unauthorized: unauthorized.status,
	}),
);
