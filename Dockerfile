# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDependencies for the build)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY . .

# Build Vite frontend + compile TypeScript server
RUN npm run build

# ── Stage 2: runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Create a non-root user for security
RUN addgroup -S sleevesnap && adduser -S sleevesnap -G sleevesnap

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy build artefacts from builder
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/dist-server ./dist-server

# Data directory (SQLite + local cover art); override with a named volume
RUN mkdir -p /data/covers && chown -R sleevesnap:sleevesnap /data

USER sleevesnap

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000 \
    CACHE_DB_PATH=/data/cache.db \
    STORAGE_LOCAL_PATH=/data/covers

ENTRYPOINT ["node", "dist-server/index.js"]
