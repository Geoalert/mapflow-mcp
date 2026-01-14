FROM oven/bun:1-alpine

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install production dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Run the MCP server
CMD ["bun", "run", "src/server.ts"]
