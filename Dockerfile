# TheMatrix Multi-Agent Cluster System
# Multi-stage build for production deployment

# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
COPY packages/config/package.json packages/config/
COPY packages/adapters/package.json packages/adapters/
COPY packages/core/package.json packages/core/
COPY packages/providers/package.json packages/providers/
COPY packages/executor/package.json packages/executor/
COPY packages/gateway/package.json packages/gateway/
COPY packages/scheduler/package.json packages/scheduler/
COPY packages/monitor/package.json packages/monitor/
COPY packages/cluster/package.json packages/cluster/
COPY apps/cli/package.json apps/cli/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/ packages/
COPY apps/ apps/

RUN pnpm build

# Stage 2: Production
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy built packages
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/apps/ apps/
COPY --from=builder /app/node_modules/ node_modules/

# Matrix CLI wrapper
COPY matrix ./matrix
RUN chmod +x matrix

# Create data directory for SQLite persistence
RUN mkdir -p /data

ENV NODE_ENV=production
ENV MATRIX_DATA_DIR=/data

EXPOSE 3001 3002

# Default: start the matrix server (gateway + monitor + scheduler)
ENTRYPOINT ["node", "apps/cli/dist/index.js"]
CMD ["server", "start"]
