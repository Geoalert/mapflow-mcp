FROM oven/bun:1-alpine

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install production dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src ./src
COPY tsconfig.json ./

ENV MAPFLOW_TRANSPORT=stdio

# Run the MCP server
CMD ["bun", "run", "src/server.ts"]
