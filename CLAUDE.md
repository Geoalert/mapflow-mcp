# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun install          # Install dependencies
bun run dev          # Run server with hot reload (--watch --hot)
bun run lint:ts      # TypeScript type checking (bunx tsc --noEmit)
bun run lint         # Biome linting with auto-fix
bun run format       # Biome formatting
bun run validate     # Run all checks: lint:ts && lint && format
bun test             # Run all tests
bun test --watch     # Run tests in watch mode
bun test <pattern>   # Run specific test file (e.g., bun test mapflow)
```

Run the server directly: `bun run src/server.ts`

## Runtime Environment

**Use Bun instead of Node.js, npm, or pnpm:**
- `bun <file>` instead of `node` or `ts-node`
- `bun test` instead of jest/vitest
- `bun install` instead of npm/yarn/pnpm install
- Bun automatically loads `.env` files (no dotenv needed)
- Prefer `Bun.file` over `node:fs` readFile/writeFile

## Architecture

This is a **Model Context Protocol (MCP) server** for the Mapflow geospatial AI platform. It runs over stdio transport using `@modelcontextprotocol/sdk`.

### Source Structure

- `src/server.ts` - MCP server entry point; registers tools and resources
- `src/mapflow-client.ts` - Mapflow API client with in-memory caching (5-minute TTL for user status)
- `src/nominatim-client.ts` - OpenStreetMap Nominatim client with rate limiting (1 req/sec)
- `src/schemas.ts` - Zod schemas for API validation (Mapflow models, processings, Nominatim results)
- `src/__tests__/` - Test files using bun:test

### MCP Tools

- `start-processing` - Creates Mapflow processing tasks with GeoJSON AOI
- `get-geoboundary` - Searches OSM Nominatim for administrative boundaries, returns simplified GeoJSON with area calculations

### MCP Resources

- `mapflow://models` - Lists available Mapflow AI models
- `mapflow://models/{modelName}/blocks` - Postprocessing blocks for a specific model
- `mapflow://limits` - User processing limits
- `mapflow://imagery-sources` - Available imagery sources for processing

### Key Patterns

- **API clients use factory functions** (`createMapflowClient()`, `createNominatimClient()`) that return typed interfaces
- **Schema validation with Zod** - All API responses are validated; schemas use `.catchall(z.unknown())` for forward compatibility
- **MCP tools return both text and structured content** for flexibility

### Key Dependencies

- `@modelcontextprotocol/sdk` - MCP server implementation
- `@turf/area`, `@turf/simplify` - Geospatial calculations
- `zod` - Schema validation for API responses

## Configuration

Requires `MAPFLOW_TOKEN` environment variable for Mapflow API authentication.

## Code Style

- Biome for linting/formatting (tab indentation, double quotes)
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Use `.js` extension in imports (e.g., `./schemas.js`)
