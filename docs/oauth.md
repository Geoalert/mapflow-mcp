# OAuth on duty

The server supports two separate routes:

- `/mcp`: existing Mapflow API token in `Authorization: Bearer <api-token>`;
  the API receives `Authorization: Basic <api-token>`. Existing stdio and
  `MAPFLOW_TOKEN` behavior is unchanged. Do not set a shared `MAPFLOW_TOKEN`
  on a public multi-user deployment: the legacy route retains its env fallback.
- `/mcp/oauth`: Keycloak access tokens only. Enabled when `MCP_OAUTH_*` is
  configured; incomplete configuration fails startup. No API-token/env fallback.

OAuth uses Keycloak directly. The MCP server validates RS256 signature, issuer,
resource audience, expiry, subject, authorized client, Bearer token type and scope.
It exchanges the incoming token for audience `mapflow`, verifies the returned
JWT and unchanged subject, then calls the same API client using Bearer auth.
The incoming token is never forwarded to Mapflow. No tokens are persisted, logged,
or cached between HTTP requests; every request performs exchange. A new stateless
MCP server/transport is created for each request. Responses use JSON; sessions and
server-initiated SSE notifications are not supported.

## Environment

See [duty values](deployment/duty-oauth-values.yaml). `MCP_OAUTH_CLIENT_SECRET`
must come from a Kubernetes Secret, not Git. Issuer/resource require HTTPS.
`MAPFLOW_BASE_URL` is required with OAuth to avoid accidentally using staging.
The example uses `https://duty.mapflow.ai`, where the live Bearer status call was
verified; the previous deployment used `https://whitemaps-duty.mapflow.ai`.

## Keycloak 20 setup

Use the confidential `mapflow-mcp-test` client already configured on duty for
Authorization Code + PKCE S256 and legacy token exchange to `mapflow`.
Direct grants, implicit flow and service accounts remain disabled.
`MCP_OAUTH_CLIENT_ID` identifies the confidential **server exchange client**.
Hosts can either use this predefined client or register their own clients via
Keycloak DCR. Do not distribute the server secret to dynamically registered
hosts. Do not reuse the public Mapflow frontend client for MCP login.

Tokens from other client IDs must contain both the MCP resource URL and the
server exchange client ID in `aud`, a nonempty `azp`, and `mapflow:mcp` in scope.
Signature, issuer, expiry and Bearer token type validation remain mandatory.
Existing tokens issued to the server client remain supported. The exchanged
token must still target `mapflow` and preserve the authenticated user's `sub`.

### Registration by URL (DCR)

The code supports DCR-issued tokens, but Keycloak provisioning is also required.
Publishing `registration_endpoint` in discovery alone is not sufficient.

1. Inspect the realm's anonymous client registration policies through Admin API
   (`components`, type `org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy`).
   Preserve the existing configuration; in the `allowed-client-templates`
   provider add `mapflow:mcp` and OIDC's `openid` to `allowed-client-scopes`. Check the actual
   requested scopes before permitting anything else.
2. On the `mapflow:mcp` client scope, configure access-token-only audience
   mappers for the resource URL and `mapflow-mcp-test`. Do not make this scope
   a realm-wide default. DCR clients must request it during registration/login.
3. Inspect Trusted Hosts, allowed protocol mappers, client limits and consent
   policies before enabling registration. Retain explicit user consent and
   require authorization code + PKCE S256; do not disable the policies wholesale.
   Trust for registration source hosts and redirect URI hosts are separate
   concerns. Codex loopback redirects also need to be supported.
4. Keep the existing exchange permission limited to `mapflow-mcp-test`.
   Dynamically registered clients must not get admin or token-exchange roles.
5. Test registration with `codex mcp login` without a predefined client ID,
   then browser login/consent and a read-only `get-limits` call. Repeat in Claude
   and ChatGPT; a successful pre-registered-client test does not prove DCR.

Keycloak 20.0.1's new admin console does not expose these registration policies
in the inspected UI. The realm's `Client policies` tab is a separate mechanism.
Use authenticated Admin API or `kcadm`; never extract browser session tokens.

### Pre-registered client setup

Before enabling the deployment:

1. Add a client scope `mapflow:mcp`, include it in the token scope, and assign it
   to this client (default, or optional with the host requesting it).
2. Add an OIDC Audience mapper to the client's dedicated scope. Included Custom
   Audience: `https://mapflow-mcp-duty.mapflow.ai/mcp/oauth`; add to access token,
   not ID token. Keycloak 20 does not dynamically bind the OAuth `resource`
   parameter, so use this dedicated fixed audience and exact resource validation.
3. Preserve the existing narrow target `mapflow` token-exchange permission for
   `mapflow-mcp-test`; do not enable impersonation/admin roles.
4. Add the exact callback URIs shown by Claude and ChatGPT when creating their
   connectors. Do not use wildcard redirects. Keep S256 required.
5. Put the existing client secret into `mapflow-mcp-oauth` Secret under the key
   `MCP_OAUTH_CLIENT_SECRET`, using the team's secret provisioning mechanism.

## Deployment

The existing duty ingress already routes `/` to the service; it includes both
MCP paths and `/.well-known/oauth-protected-resource/mcp/oauth`.

The current Helm chart only supports literal `extraEnv`. Apply
[the envFrom patch](deployment/mapflow-mcp-secret-env.patch) in
`mapflow-platform-kubernetes`, then merge the duty values above. This optional
chart field leaves other environments unchanged.

The GitLab project `geoalert-projects/map-flow/mapflow-mcp-docker` (476) builds
GitHub `Geoalert/mapflow-mcp` **main**, and publishes to the existing registry with
an upstream short SHA tag. Publish/merge the implementation upstream first,
run that build pipeline, then set `mapflowMcp.tag` to its published SHA and roll
out via the deployment CI. A local code change alone does not update duty.

## Verification

Unauthenticated GET `/mcp/oauth` must return 401 with `WWW-Authenticate` pointing
to the metadata URL. GET that URL must return the exact resource, issuer and
`mapflow:mcp` scope. Missing/invalid tokens return 401, missing scope returns 403;
exchange failures return 502 without provider error bodies or credentials.

In each host, add a remote MCP connector with URL
`https://mapflow-mcp-duty.mapflow.ai/mcp/oauth` and select OAuth. With DCR configured,
leave predefined client credentials empty. Sign in as the user, then
list tools and invoke `get-limits` (GET `/rest/user/status`). Confirm the account
matches the intended user. Do not test with `start-processing`, which is billable.
Also verify an existing API-token connection to `/mcp` still works.

For URL-only setup, publish the server's RFC 8414 document on the **issuer host**
at `/.well-known/oauth-authorization-server/auth/realms/mapflow-duty` through an
exact-path ingress to MCP. The document keeps the real Keycloak issuer and direct
authorization, token, registration and JWKS endpoints, but advertises only
`openid` and `mapflow:mcp`. The existing Keycloak ingress retains TLS and all
other routes, including its original OIDC discovery used by Mapflow Web.
This does not proxy login or tokens. It affects OAuth discovery for this duty
issuer; other OAuth consumers needing broader scopes should request them
explicitly or use the existing OIDC discovery.

Codex 0.160.0 and the tested desktop CLI requested all authorization-server
scopes during DCR despite narrower protected-resource metadata. Without the
RFC 8414 route, they fall back to the realm-wide OIDC list and Keycloak rejects
registration. Do not allow all realm scopes to work around this. The route
depends on MCP availability; include it in deployment smoke checks.

Configure only the URL and run `codex mcp login <name>` without `--scopes`,
client credentials or a registration strategy override. Test with a fresh
server name so a previous login cannot hide registration failures.
Successful login alone does not prove the deployed server accepts DCR tokens.

`bun test` covers signed JWT validation, wrong audience/client/type, expiry,
missing scope, exchange identity/audience mismatch, sanitized exchange failure,
metadata/challenges, OAuth tool-to-backend Bearer forwarding, existing stdio,
and independent legacy HTTP clients. These local tests do not establish that
Claude or ChatGPT has connected to the deployed server.

References: [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth),
[Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
