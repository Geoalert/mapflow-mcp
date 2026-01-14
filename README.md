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

| Tool | Description |
|------|-------------|
| `start-processing` | Create a Mapflow processing task with GeoJSON AOI |
| `get-processing` | Get status and results of a processing task |
| `calculate-cost` | Estimate cost in credits before starting |
| `get-geoboundary` | Search OSM Nominatim for administrative boundaries |

## Resources

| Resource | Description |
|----------|-------------|
| `mapflow://models` | Available AI models |
| `mapflow://models/{name}/blocks` | Postprocessing blocks for a model |
| `mapflow://limits` | User processing limits and credits |
| `mapflow://imagery-sources` | Available satellite imagery sources |

## Getting a Token

Get your Mapflow API token at [app.mapflow.ai](https://app.mapflow.ai).

## License

MIT
