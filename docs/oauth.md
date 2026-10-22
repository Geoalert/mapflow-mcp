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
Both hosts must use this predefined client ID and its secret: this implementation
requires incoming `azp` to equal `MCP_OAUTH_CLIENT_ID`. Open dynamic registration
is not needed. Do not reuse the public Mapflow frontend client for MCP login.

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
`https://mapflow-mcp-duty.mapflow.ai/mcp/oauth`, select OAuth and predefined client
credentials. Copy its exact callback URI into Keycloak, sign in as the user, then
list tools and invoke `get-limits` (GET `/rest/user/status`). Confirm the account
matches the intended user. Do not test with `start-processing`, which is billable.
Also verify an existing API-token connection to `/mcp` still works.

`bun test` covers signed JWT validation, wrong audience/client/type, expiry,
missing scope, exchange identity/audience mismatch, sanitized exchange failure,
metadata/challenges, OAuth tool-to-backend Bearer forwarding, existing stdio,
and independent legacy HTTP clients. These local tests do not establish that
Claude or ChatGPT has connected to the deployed server.

References: [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth),
[Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
