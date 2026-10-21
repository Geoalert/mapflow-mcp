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

The server exposes 17 tools. Parameters and REST mappings are documented in
[the tool contract specification](docs/tool-contracts.md).

| Tool | Description |
|------|-------------|
| `list-models` | Available models and processing blocks |
| `list-imagery-sources` | Available providers, zoom levels and prices |
| `get-limits` | Fresh limits and remaining credits |
| `list-projects` | Paginated project search |
| `get-project` | Project by UUID or `default` |
| `list-mosaics` | Paginated My Imagery search |
| `get-mosaic` | Metadata and footprint converted to GeoJSON |
| `get-mosaic-status` | Data readiness, loading and per-image failures |
| `list-processings` | Paginated processing search within a project |
| `get-processing` | Status, progress and layer metadata |
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

Only `start-processing` writes to Mapflow. The caller must show and obtain user
confirmation of the estimate for the exact configuration being launched. An
area-only estimate or an estimate without a source is marked `preliminary`.
Mosaic loading/preprocessing blocks launch; partial failures produce warnings.
Launch requests are never automatically retried. After an ambiguous network
failure, check `list-processings` before deciding whether to retry.

Results are returned as validated structured content and JSON text. Tool errors
use `isError`. Result file downloading, uploads, project mutations and agent
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

## Development checks

```bash
bun validate
bun test
```

Tests use API fixtures, real MCP client/server calls, and subprocess smoke tests
for stdio and HTTP. The HTTP smoke test binds a loopback port. Tests do not start
paid Mapflow jobs or require live credentials.

## Getting a Token

Get your Mapflow API token at [app.mapflow.ai](https://app.mapflow.ai).

## License

MIT
