import { createRemoteJWKSet, jwtVerify } from "jose";
import * as z from "zod";

const secureUrl = z.url().refine((value) => {
	const url = new URL(value);
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		!url.search &&
		!url.hash
	);
}, "Expected an HTTPS URL without credentials, query or fragment");
const configSchema = z.object({
	issuer: secureUrl,
	resource: secureUrl.refine(
		(value) => new URL(value).pathname === "/mcp/oauth",
		"Resource path must be /mcp/oauth",
	),
	clientId: z.string().min(1),
	clientSecret: z.string().min(1),
	audience: z.string().min(1),
	scope: z.string().regex(/^[a-zA-Z0-9:._-]+$/),
});
export type OAuthConfig = z.infer<typeof configSchema>;
export function readOAuthConfig(
	env: Record<string, string | undefined>,
): OAuthConfig | undefined {
	if (!Object.keys(env).some((key) => key.startsWith("MCP_OAUTH_") && env[key]))
		return;
	const result = configSchema.safeParse({
		issuer: env.MCP_OAUTH_ISSUER,
		resource: env.MCP_OAUTH_RESOURCE,
		clientId: env.MCP_OAUTH_CLIENT_ID,
		clientSecret: env.MCP_OAUTH_CLIENT_SECRET,
		audience: env.MCP_OAUTH_API_AUDIENCE ?? "mapflow",
		scope: env.MCP_OAUTH_SCOPE ?? "mapflow:mcp",
	});
	if (!result.success)
		throw new Error(
			`Invalid OAuth configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
		);
	return result.data;
}
export class OAuthError extends Error {
	constructor(
		public readonly status: 401 | 403 | 502,
		public readonly code: string,
	) {
		super(code);
	}
}
const tokenResponse = z.object({
	access_token: z.string().min(1),
	token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
});
export function createOAuth(config: OAuthConfig) {
	const issuer = config.issuer.replace(/\/$/, "");
	const keys = createRemoteJWKSet(
		new URL(`${issuer}/protocol/openid-connect/certs`),
		{ timeoutDuration: 5000 },
	);
	const metadataUrl = `${new URL(config.resource).origin}/.well-known/oauth-protected-resource/mcp/oauth`;
	const verify = async (token: string, audience: string) =>
		(
			await jwtVerify(token, keys, {
				issuer,
				audience,
				algorithms: ["RS256"],
				requiredClaims: ["exp", "sub", "iat"],
			})
		).payload;
	return {
		metadata: {
			resource: config.resource,
			authorization_servers: [issuer],
			scopes_supported: [config.scope],
			bearer_methods_supported: ["header"],
		},
		errorResponse(error: OAuthError) {
			return Response.json(
				{ error: error.code },
				{
					status: error.status,
					headers: {
						"Cache-Control": "no-store",
						...(error.status !== 502
							? {
									"WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="${config.scope}", error="${error.code}"`,
								}
							: {}),
					},
				},
			);
		},
		async authenticate(header: string | null) {
			const token = /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
			if (!token) throw new OAuthError(401, "invalid_token");
			let source: Awaited<ReturnType<typeof verify>>;
			try {
				source = await verify(token, config.resource);
			} catch {
				throw new OAuthError(401, "invalid_token");
			}
			// DCR clients have their own azp. They must explicitly delegate to
			// this exchange client as well as target the MCP resource above.
			const audiences = Array.isArray(source.aud) ? source.aud : [source.aud];
			if (
				typeof source.azp !== "string" ||
				!source.azp ||
				source.typ !== "Bearer" ||
				(source.azp !== config.clientId && !audiences.includes(config.clientId))
			)
				throw new OAuthError(401, "invalid_token");
			if (
				typeof source.scope !== "string" ||
				!source.scope.split(" ").includes(config.scope)
			)
				throw new OAuthError(403, "insufficient_scope");
			try {
				const response = await fetch(
					`${issuer}/protocol/openid-connect/token`,
					{
						method: "POST",
						redirect: "error",
						signal: AbortSignal.timeout(10000),
						body: new URLSearchParams({
							grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
							client_id: config.clientId,
							client_secret: config.clientSecret,
							subject_token: token,
							subject_token_type:
								"urn:ietf:params:oauth:token-type:access_token",
							requested_token_type:
								"urn:ietf:params:oauth:token-type:access_token",
							audience: config.audience,
						}),
					},
				);
				if (!response.ok) {
					await response.body?.cancel();
					throw new Error("Exchange rejected");
				}
				const result = tokenResponse.parse(await response.json());
				const target = await verify(result.access_token, config.audience);
				if (target.sub !== source.sub || target.typ !== "Bearer")
					throw new Error("Exchange identity mismatch");
				return { scheme: "Bearer" as const, token: result.access_token };
			} catch {
				throw new OAuthError(502, "token_exchange_failed");
			}
		},
	};
}
