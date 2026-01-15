# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy root package files
COPY package.json pnpm-lock.yaml ./

# Copy MCP server package files
COPY src/mcp-server/telegram-mcp/package.json src/mcp-server/telegram-mcp/package-lock.json* ./src/mcp-server/telegram-mcp/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Install MCP server dependencies
WORKDIR /app/src/mcp-server/telegram-mcp
RUN npm ci --ignore-scripts

# Go back to root
WORKDIR /app

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build MCP server
WORKDIR /app/src/mcp-server/telegram-mcp
RUN npm run build

# Build main app
WORKDIR /app
RUN pnpm exec tsc

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 botuser

# Copy root package files and install production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy MCP server package files and install production dependencies
COPY src/mcp-server/telegram-mcp/package.json src/mcp-server/telegram-mcp/package-lock.json* ./src/mcp-server/telegram-mcp/
WORKDIR /app/src/mcp-server/telegram-mcp
RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force

# Go back to root
WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/mcp-server/telegram-mcp/build ./src/mcp-server/telegram-mcp/build

# Set ownership
RUN chown -R botuser:nodejs /app

# Switch to non-root user
USER botuser

# Environment variables (override at runtime)
ENV NODE_ENV=production
ENV MCP_HTTP_PORT=3001
ENV TELEGRAM_MCP_HOST=http://localhost:3001

# Expose MCP server port
EXPOSE 3001

# Health check for MCP server
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the bot (which forks the MCP server)
CMD ["node", "dist/index.js"]
