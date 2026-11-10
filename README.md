# mapflow-mcp

MCP server for the [Mapflow](https://mapflow.ai) geospatial AI platform. Enables AI assistants to run satellite imagery analysis tasks.

## Quick Start with Docker

```bash
docker run -i --rm -e MAPFLOW_TOKEN=your_token ghcr.io/geoalert/mapflow-mcp:latest
```

## Configuration

### Claude Code

```bash
claude mcp add mapflow -e MAPFLOW_TOKEN=your_token -- docker run -i --rm -e MAPFLOW_TOKEN ghcr.io/geoalert/mapflow-mcp:latest
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mapflow": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MAPFLOW_TOKEN", "ghcr.io/geoalert/mapflow-mcp:latest"],
      "env": {
        "MAPFLOW_TOKEN": "your_token"
      }
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mapflow": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MAPFLOW_TOKEN", "ghcr.io/geoalert/mapflow-mcp:latest"],
      "env": {
        "MAPFLOW_TOKEN": "your_token"
      }
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "mapflow": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MAPFLOW_TOKEN", "ghcr.io/geoalert/mapflow-mcp:latest"],
      "env": {
        "MAPFLOW_TOKEN": "your_token"
      }
    }
  }
}
```

### VS Code (Copilot)

Edit `.vscode/mcp.json` in your workspace or `~/.vscode/mcp.json` globally:

```json
{
  "servers": {
    "mapflow": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MAPFLOW_TOKEN", "ghcr.io/geoalert/mapflow-mcp:latest"],
      "env": {
        "MAPFLOW_TOKEN": "your_token"
      }
    }
  }
}
```

### Running from source

```bash
bun install
MAPFLOW_TOKEN=your_token bun run src/server.ts
```

## Tools

The server exposes 19 tools. Parameters and REST mappings are documented in
[the tool contract specification](docs/tool-contracts.md).

| Tool | Description |
|------|-------------|
| `list-models` | Available models and processing blocks |
| `list-imagery-sources` | Available providers, zoom levels and prices |
| `get-limits` | Fresh limits and remaining credits |
| `list-projects` | Paginated project search |
| `create-project` | Create a project with a name and optional description |
| `get-project` | Project by UUID or `default` |
| `list-mosaics` | Paginated My Imagery search |
| `get-mosaic` | Metadata and footprint converted to GeoJSON |
| `get-mosaic-status` | Data readiness, loading and per-image failures |
| `list-processings` | Paginated processing search within a project |
| `get-processing` | Status and progress, without internal map-layer URLs |
| `get-processing-result` | Current or original GeoJSON as an embedded MCP resource, up to 5 MiB |
| `get-processing-statistics` | Counts, areas and lengths by class |
| `search-imagery-catalog` | Imagery search by AOI and filters |
| `get-image-metadata` | Metadata for a catalog image |
| `get-geoboundary` | OSM place geometry with an optional explicit buffer |
| `buffer-aoi` | Buffer a geometry in meters |
| `calculate-cost` | Total credits and imagery/processing breakdown |
| `start-processing` | Start a processing after user confirmation |

Inputs use camelCase. Lists default to `limit: 20`, `offset: 0` (limit 1–100).
AOIs must be valid WGS84 Polygon/MultiPolygon geometries. Points and lines from
geocoding require an explicit positive `bufferMeters`.

Geometry output follows the same policy in `get-geoboundary`, `buffer-aoi`,
`get-mosaic`, `search-imagery-catalog` and `get-image-metadata`, including all
composite preview parts:

- `geometryMode: "summary"` (default): geometryId, expiry, exact bbox/area,
  vertex count and serialized full-geometry size, without coordinates.
- `geometryMode: "simplified"`: display-only contours, up to `maxVertices`
  (default 200, maximum 1,000) per contour and a 32 KiB total response budget.
  If a valid overview cannot fit, return its summary. Shapes with holes are
  not simplified if they exceed the vertex budget, to avoid changing topology.
- `geometryMode: "full"`: requires an explicit `maxOutputBytes` acknowledgement
  (1,024–262,144 bytes) and always includes a context-size warning. Without a
  budget, return summaries and the warning. If the response exceeds the budget,
  omit **all** coordinates and report `requiredOutputBytes`. Even the hard limit
  cannot be overridden. Reduce the page size or use geometryId instead.

Budgets count the entire MCP result, including both JSON text and structured
content, across every image and preview. Summary/simplified responses are capped
at 32 KiB; an explicit smaller budget is respected. An oversized summary fails
with `GEOMETRY_OUTPUT_TOO_LARGE` rather than silently truncating the page.
`includeGeometry: true` remains a deprecated alias for `full`, with exactly the
same budget requirement; combining it with `geometryMode` is rejected.

Geocoding/buffering expose summary fields at the top level. Mosaics add
`geometrySummary`; catalog images add `footprintSummary`, and preview parts add
`geometrySummary` alongside their URL. Optional `geometry`/`footprint` fields
appear only when coordinates are permitted. Invalid/unsupported polygons are
omitted with a warning; missing footprints have a null summary. Exact polygons
are cached, never replaced by simplified display contours.

`buffer-aoi`, `search-imagery-catalog`, `calculate-cost` and `start-processing`
accept either `geometryId` or direct `geometry`, never both. Cost also accepts
`areaSqKm` instead of either geometry input for preliminary estimates.
Existing direct GeoJSON inputs remain supported.

Geometry is kept only in process memory: 24 hours of inactivity, at most 1,000
entries and 32 MiB of serialized geometry payload across users. Reads refresh
the TTL; `expiresAt` reflects expiry at creation. Expired entries are removed on
cache access, and least recently used entries are evicted when capacity is
needed. A geometry larger than the byte budget fails with `GEOMETRY_TOO_LARGE`.
OAuth entries are scoped to the verified issuer/subject, surviving token refresh;
API-token entries are scoped to a hash of the token (including the configured
single-user environment token). Buffering creates a new ID and preserves the
original geometry. Coordinates and owner keys are not logged.

Use one MCP replica, or route a user's calls consistently to the same replica.
The cache is shared across HTTP requests but is neither persisted nor replicated.
Restart, expiry, eviction or an inaccessible ID returns `GEOMETRY_EXPIRED` before
any processing is submitted. Repeat the original geocoding/mosaic/catalog lookup and buffers (or supply GeoJSON),
then recalculate cost and obtain confirmation before launching. The server does
not automatically reconstruct geometry or retry a paid launch.

For `get-image-metadata`, pass `imageId`, `dataProvider` and, when available,
`zoom` from the catalog search result. The server uses the multi-provider
`/rest/catalog/{imageId}` route and rejects ambiguous matches instead of silently
selecting a different zoom. `dataProvider: "maxar"` selects the legacy Maxar-only
metadata endpoint. Statistics preserve nullable geometry types for empty groups
and the backend's display names, colors, metrics and ordering.

Catalog responses preserve composite preview URLs and contour summaries; full
`footprint` and preview coordinates follow the explicit geometry output policy.
Use all preview parts for Roscosmos. Inactive Skywatch sources are excluded.
For best-image selection, sort by the user's criterion and follow `hasNext`
using `offset + count`; the first page alone is not the complete search result.

`get-processing-result` checks access and completion, then downloads through the
same authenticated backend transport. It returns metadata plus an embedded
`application/geo+json` resource; save its text using `fileName`. The URI identifies
the inline resource, not a public link or a separately stored server file.
There is no server cache or expiry. Downloads exceeding 5 MiB are cancelled;
larger results must be downloaded in Mapflow. Requires backend result endpoints
with actor/AOI authorization (verified in duty backend `a5b00a4d`).

Both cost and launch accept a `source`:

```json
{ "type": "provider", "name": "Mapbox", "zoom": 18 }
```

```json
{ "type": "catalog", "dataProvider": "roscosmos", "imageIds": ["image-id"] }
```

```json
{ "type": "myImagery", "mosaicId": "550e8400-e29b-41d4-a716-446655440000" }
```

Use the actual provider and model names returned for the account. The legacy
`dataProvider: {name, zoom}` remains supported; combining it with `source` is an error.
`meta` and `inferenceParams` accept string values, matching WM's API contract.

`create-project` and `start-processing` write to Mapflow. For a processing launch,
the caller must show and obtain user
confirmation of the estimate for the exact configuration being launched. An
area-only estimate or an estimate without a source is marked `preliminary`.
Mosaic loading/preprocessing blocks launch; partial failures produce warnings.
Launch requests are never automatically retried. After an ambiguous network
failure, check `list-processings` before deciding whether to retry.

`create-project` accepts `name` (1–128 characters after trimming) and optional
`description` (up to 1024 characters). It returns the project, including its `id`:
pass this ID as `projectId` to `start-processing`. Creation does not start a paid
processing. Repeated calls can create duplicate projects; after a timeout or an
unrecognized creation response, check `list-projects` for the requested name
before considering another create call.

Results are returned as validated structured content and JSON text. Tool errors
use `isError`. Result file downloading, uploads, project updates/deletion/sharing and agent
session/memory tools are not exposed. Legacy MCP resources are not registered;
use `list-models`, `list-imagery-sources` and `get-limits` instead.

## HTTP transport

```bash
MAPFLOW_TRANSPORT=http PORT=3000 bun run src/server.ts
```

Connect to `/mcp` with `Authorization: Bearer <Mapflow token>`. The server forwards
the token to Mapflow using its Basic token authentication. `MAPFLOW_TOKEN` is the
fallback for configured single-user deployments and stdio. Account caches are
isolated by token. `MAPFLOW_BASE_URL` defaults to `https://whitemaps-staging.mapflow.ai`;
set it explicitly for another environment.

## Logging

The server writes newline-delimited JSON to **stderr** using Pino. stdout is
reserved for MCP messages in stdio mode. Set `LOG_LEVEL` to `trace`, `debug`,
`info` (default), `warn`, `error`, `fatal`, or `silent`. An invalid value falls
back to `info`. Completion events use `info` for success and `error` for failure.

Events include `server.started`, `server.failed`, `http.completed`,
`tool.completed`, `api.completed`, and `oauth.completed`. Request events carry
a generated `requestId`, `durationMs`, and `outcome`; tool events also include
the registered tool name. API events identify `upstream` (`mapflow` or
`nominatim`), with HTTP `status` when available. Errors carry a bounded
`errorCode`, never the original exception text.

Each HTTP request gets a new ID, returned in `X-Request-Id`. The same ID follows
its tool and API calls. Client-provided IDs are not trusted or logged. In stdio
mode each tool call gets its own ID. Concurrent calls keep separate contexts.
Tool completion includes SDK validation failures and unknown tool names (logged
as `unknown`). An HTTP 200 can contain an MCP error: inspect `tool.completed`
for the operation's outcome.

```json
{"level":"info","time":"2026-10-27T12:00:00.000Z","service":"mapflow-mcp","event":"tool.completed","requestId":"6e26726e-4580-4ed4-9b19-171e7dbd305d","tool":"get-limits","outcome":"success","durationMs":42.15}
```

Logs omit tokens, headers, request/response bodies, geometry, search strings,
URLs, resource IDs, raw errors, stacks, and validation details. Results are
recorded only as success/error and status codes. Nominatim no longer logs its
search URL. `durationMs` measures server handling time, not client delivery;
JSON API calls include parsing/validation, while raw API calls end at response
headers. Nominatim duration includes its rate-limit wait. If stderr becomes
unavailable, logging is best-effort and does not change operation results.
Log collection, retention, and rotation belong to the runtime/container setup.

## Development checks

```bash
bun validate
bun test
```

Tests use API fixtures, real MCP client/server calls, and subprocess smoke tests
for stdio and HTTP. The HTTP smoke test binds a loopback port. Tests do not start
paid Mapflow jobs or require live credentials.

## Duty deployment

A push to GitHub `main` builds GHCR images; it does **not** update duty.
Duty uses the GitLab project `geoalert-projects/map-flow/mapflow-mcp-docker`
(project 476), whose pipeline builds this repository and publishes
`registry.idono.work/geoalert-projects/map-flow/mapflow-mcp-docker:<upstream-sha>`.
Pin `UPSTREAM_REF` through the build's `DOCKERARGS` when triggering a release and
verify the published SHA tag matches the source commit.

With the current GitLab registry, set the pipeline variable
`BUILDX_NO_DEFAULT_ATTESTATIONS=1`: the builder's unpinned `docker:dind` now emits
an attestation manifest index that this registry rejects with `blob unknown`.
This disables default provenance attestations for that build. Check both the
`build` and `push:upstream-sha` jobs; the latter derives its tag from GitHub `main`,
so verify that `main` still points to the pinned source before deployment.

Update only `mapflowMcp.tag` in `envs/duty/mapflow.yaml` of
`mapflow-platform-kubernetes`, merge the deployment MR, then run
`mapflow:duty:deploy` after lint/dryrun pass. Verify the deploy job and exercise
`https://mapflow-mcp-duty.mapflow.ai/mcp/oauth` through an authenticated connection.
Local tests or a successful image build alone do not confirm deployment.

## Getting a Token

Get your Mapflow API token at [app.mapflow.ai](https://app.mapflow.ai).

## License

MIT

### OAuth (Keycloak)

The optional `/mcp/oauth` endpoint supports Authorization Code + PKCE through
Keycloak, JWT verification and user token exchange to the Mapflow API. The
existing `/mcp` API-token endpoint and stdio mode are retained.
See [OAuth setup and duty deployment](docs/oauth.md) for environment variables,
Keycloak configuration, secret injection and Claude/ChatGPT verification.
