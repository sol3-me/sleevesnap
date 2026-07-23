# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDependencies for the build).
# scripts/ is copied ahead of the rest of the source because postinstall
# (copyFlagIcons.mjs) runs during `npm ci`, before the main `COPY . .` below.
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci

# Copy source
COPY . .

# Vite inlines VITE_* vars into the client bundle at build time (this RUN
# step), not at container runtime — they must arrive as build-args, not as
# regular container env vars. These are public client identifiers, not
# secrets (see lib/firebase.ts), but --build-arg is still the only way to
# get them into this stage at all.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

# Build Vite frontend + compile TypeScript server
RUN npm run build

# ── Stage 2: runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Create a non-root user for security
RUN addgroup -S sleevesnap && adduser -S sleevesnap -G sleevesnap

WORKDIR /app

# Install production dependencies only. scripts/ is copied ahead of npm ci
# so postinstall (copyFlagIcons.mjs) can find its file — it no-ops here since
# flag-icons is a devDependency, but native deps like better-sqlite3 still
# need their own install scripts to run, so --ignore-scripts isn't an option.
COPY package.json package-lock.json* ./
COPY scripts ./scripts
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
