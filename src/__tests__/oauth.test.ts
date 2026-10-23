import { expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createHttpHandler } from "../http-server.js";
import { createOAuth, type OAuthConfig, readOAuthConfig } from "../oauth.js";

async function fixture() {
	const pair = await generateKeyPair("RS256");
	const jwk = await exportJWK(pair.publicKey);
	let issuer = "";
	let exchanges = 0;
	let targetSubject = "user-1";
	let targetAudience = "mapflow";
	let rejectExchange = false;
	const sign = (claims: Record<string, unknown> = {}, expires = "5m") =>
		new SignJWT({
			sub: "user-1",
			azp: "mcp-test",
			typ: "Bearer",
			scope: "mapflow:mcp",
			...claims,
		})
			.setProtectedHeader({ alg: "RS256", kid: "test" })
			.setIssuer(issuer)
			.setIssuedAt()
			.setExpirationTime(expires)
			.sign(pair.privateKey);
	const provider = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(req) {
			if (new URL(req.url).pathname.endsWith("/certs"))
				return Response.json({ keys: [{ ...jwk, kid: "test", alg: "RS256" }] });
			exchanges++;
			const body = await req.formData();
			expect(body.get("grant_type")).toBe(
				"urn:ietf:params:oauth:grant-type:token-exchange",
			);
			expect(body.get("client_secret")).toBe("test-secret");
			expect(body.get("client_id")).toBe("mcp-test");
			expect(body.get("audience")).toBe("mapflow");
			if (rejectExchange)
				return new Response("private provider diagnostics", { status: 400 });
			return Response.json({
				access_token: await sign({ sub: targetSubject, aud: targetAudience }),
				token_type: "Bearer",
			});
		},
	});
	issuer = `http://127.0.0.1:${provider.port}`;
	const config: OAuthConfig = {
		issuer,
		resource: "https://mcp.example/mcp/oauth",
		clientId: "mcp-test",
		clientSecret: "test-secret",
		audience: "mapflow",
		scope: "mapflow:mcp",
	};
	return {
		config,
		sign,
		provider,
		exchanges: () => exchanges,
		changeTarget: (sub: string, aud: string) => {
			targetSubject = sub;
			targetAudience = aud;
		},
		reject: () => {
			rejectExchange = true;
		},
	};
}

test("OAuth verifies signatures, audience, client and scopes before exchanging", async () => {
	const f = await fixture();
	try {
		const auth = createOAuth(f.config);
		for (const claims of [
			{ aud: "other" },
			{ aud: f.config.resource, azp: "other" },
			{ aud: "mcp-test", azp: "dynamic-client" },
			{ aud: [f.config.resource, "mcp-test"], azp: "" },
			{ aud: [f.config.resource, "mcp-test"], azp: null },
			{ aud: f.config.resource, typ: "ID" },
		]) {
			await expect(
				auth.authenticate(`Bearer ${await f.sign(claims)}`),
			).rejects.toMatchObject({ status: 401 });
		}
		await expect(
			auth.authenticate("Bearer forged.token.signature"),
		).rejects.toMatchObject({ status: 401 });
		await expect(
			auth.authenticate(
				`Bearer ${await f.sign({ aud: f.config.resource, scope: "openid" })}`,
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			auth.authenticate(
				`Bearer ${await f.sign({ aud: f.config.resource }, "-1s")}`,
			),
		).rejects.toMatchObject({ status: 401 });
		expect(f.exchanges()).toBe(0);
		const credentials = await auth.authenticate(
			`Bearer ${await f.sign({ aud: f.config.resource })}`,
		);
		expect(credentials.scheme).toBe("Bearer");
		expect(f.exchanges()).toBe(1);
	} finally {
		f.provider.stop(true);
	}
});

test("DCR clients can delegate to the server exchange client with both audiences", async () => {
	const f = await fixture();
	try {
		const auth = createOAuth(f.config);
		const claims = {
			azp: "dynamically-registered-client",
			aud: [f.config.resource, f.config.clientId],
		};
		await expect(
			auth.authenticate(
				`Bearer ${await f.sign({ ...claims, scope: "openid" })}`,
			),
		).rejects.toMatchObject({ status: 403 });
		expect(f.exchanges()).toBe(0);
		expect(
			(await auth.authenticate(`Bearer ${await f.sign(claims)}`)).scheme,
		).toBe("Bearer");
		expect(f.exchanges()).toBe(1);
		f.changeTarget("another-user", "mapflow");
		await expect(
			auth.authenticate(`Bearer ${await f.sign(claims)}`),
		).rejects.toMatchObject({ status: 502 });
	} finally {
		f.provider.stop(true);
	}
});

test("Exchange cannot change identity or target audience; failures are sanitized", async () => {
	const f = await fixture();
	try {
		const auth = createOAuth(f.config);
		const header = `Bearer ${await f.sign({ aud: f.config.resource })}`;
		f.changeTarget("another-user", "mapflow");
		await expect(auth.authenticate(header)).rejects.toMatchObject({
			status: 502,
			message: "token_exchange_failed",
		});
		f.changeTarget("user-1", "another-api");
		await expect(auth.authenticate(header)).rejects.toMatchObject({
			status: 502,
		});
		f.reject();
		await expect(auth.authenticate(header)).rejects.toMatchObject({
			status: 502,
			message: "token_exchange_failed",
		});
	} finally {
		f.provider.stop(true);
	}
});

test("OAuth HTTP discovery and challenges never fall back to the environment token", async () => {
	const f = await fixture();
	try {
		const handle = createHttpHandler(f.config);
		const metadata = await handle(
			new Request(
				"https://mcp.example/.well-known/oauth-protected-resource/mcp/oauth",
			),
		);
		expect(await metadata.json()).toMatchObject({
			resource: f.config.resource,
			authorization_servers: [f.config.issuer],
		});
		const missing = await handle(new Request(f.config.resource));
		expect(missing.status).toBe(401);
		expect(missing.headers.get("www-authenticate")).toContain(
			"resource_metadata=",
		);
		const denied = await handle(
			new Request(f.config.resource, {
				headers: {
					Authorization: `Bearer ${await f.sign({ aud: f.config.resource, scope: "openid" })}`,
				},
			}),
		);
		expect(denied.status).toBe(403);
		expect(f.exchanges()).toBe(0);
		const response = await handle(
			new Request(f.config.resource, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${await f.sign({ aud: f.config.resource })}`,
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			result: {
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "get-limits" }),
				]),
			},
		});
	} finally {
		f.provider.stop(true);
	}
});

test("Keycloak OAuth discovery advertises only MCP scopes and direct issuer endpoints", async () => {
	const config = {
		issuer: "https://auth.example/auth/realms/duty",
		resource: "https://mcp.example/mcp/oauth",
		clientId: "mcp-test",
		clientSecret: "never-publish-this",
		audience: "mapflow",
		scope: "mapflow:mcp",
	};
	const path = "/.well-known/oauth-authorization-server/auth/realms/duty";
	const handle = createHttpHandler(config);
	const response = await handle(new Request(`https://auth.example${path}`));
	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body).toMatchObject({
		issuer: config.issuer,
		scopes_supported: ["openid", "mapflow:mcp"],
		code_challenge_methods_supported: ["S256"],
		registration_endpoint: `${config.issuer}/clients-registrations/openid-connect`,
		token_endpoint: `${config.issuer}/protocol/openid-connect/token`,
	});
	expect(JSON.stringify(body)).not.toContain(config.clientSecret);
	expect(
		(
			await handle(
				new Request(`https://auth.example${path}`, { method: "POST" }),
			)
		).status,
	).toBe(405);
	expect(
		(await createHttpHandler()(new Request(`https://auth.example${path}`)))
			.status,
	).toBe(404);
});

test("OAuth configuration is opt-in and rejects partial or insecure configuration", () => {
	expect(readOAuthConfig({})).toBeUndefined();
	expect(() =>
		readOAuthConfig({ MCP_OAUTH_CLIENT_SECRET: "must-not-leak" }),
	).toThrow("Invalid OAuth configuration");
	const env = {
		MCP_OAUTH_ISSUER: "https://issuer.example/realm",
		MCP_OAUTH_RESOURCE: "https://mcp.example/mcp/oauth",
		MCP_OAUTH_CLIENT_ID: "mcp",
		MCP_OAUTH_CLIENT_SECRET: "secret",
	};
	expect(readOAuthConfig(env)?.scope).toBe("mapflow:mcp");
	expect(() =>
		readOAuthConfig({ ...env, MCP_OAUTH_ISSUER: "http://issuer.example" }),
	).toThrow();
});

test("OAuth tool call reaches user status with the exchanged Bearer token", async () => {
	const f = await fixture();
	const previousBase = process.env.MAPFLOW_BASE_URL;
	let seen = "";
	const backend = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(req) {
			expect(new URL(req.url).pathname).toBe("/rest/user/status");
			seen = req.headers.get("authorization") ?? "";
			return Response.json({ remainingCredits: 42 });
		},
	});
	process.env.MAPFLOW_BASE_URL = `http://127.0.0.1:${backend.port}`;
	try {
		const source = await f.sign({ aud: f.config.resource });
		const response = await createHttpHandler(f.config)(
			new Request(f.config.resource, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${source}`,
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "get-limits", arguments: {} },
				}),
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			result: { structuredContent: { remainingCredits: 42 } },
		});
		expect(seen.startsWith("Bearer ")).toBe(true);
		expect(seen).not.toBe(`Bearer ${source}`);
	} finally {
		if (previousBase === undefined) delete process.env.MAPFLOW_BASE_URL;
		else process.env.MAPFLOW_BASE_URL = previousBase;
		backend.stop(true);
		f.provider.stop(true);
	}
});
