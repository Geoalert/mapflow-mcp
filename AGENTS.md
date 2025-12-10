# Mapflow MCP Server

## Main rules

- This project is mcp server for mapflow.ai api
- Use context7 to get actual mcp sdk docs
- If you need to knwo about mapflow api, use context7 to get actual docs
- Always use context7 if you work with some library or framework
- Use context7 to get actual biome docs
- Always run `bun validate` to check code style and linter issues after modifying code

## Fixing linter issues

1. When writing or modifying code, if linter(biome) errors occur — fix them first.
2. After successfully fixing each linter error:
   - Add a short description of the correct coding practice that prevents this error.
   - Append this description to the `AGENTS.md` file to the 'Known issues' section in the following format:
     ```
     ## Known issues
     ...
     - short explanation of the correct way to write code
     ```
3. Do not duplicate existing entries in 'Known issues'.
4. Keep all descriptions concise, clear, and focused on how to write code correctly according to the linter rules.
   Important Note:
   > These rules only apply to linter (biome) errors and do not cover logical or business logic errors.

## Known issues

- Use type-only imports (e.g., `import type { Foo }`) when `verbatimModuleSyntax` is enabled to satisfy TypeScript’s module rules.
- Prefer `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` instead of the deprecated `Server` import.

## Logging

1. Use a logging library that writes to stderr or files
2. For JavaScript, be especially careful - console.log() writes to stdout by default

```ts
// ❌ Bad (STDIO)
console.log("Server started");

// ✅ Good (STDIO)
console.error("Server started"); // stderr is safe
```
​


## Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

