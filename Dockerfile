# syntax=docker/dockerfile:1
#
# shh — self-destructing secret sharing.
#
# Multi-stage build producing a small, non-root image around Next.js's
# `output: "standalone"` bundle. Built per-architecture (amd64 / arm64) so
# better-sqlite3's native binding always matches the runtime — the whole class
# of problem `deployment/deploy.sh` works around when cross-building for a Pi.

ARG NODE_VERSION=22-alpine

# ─── deps ────────────────────────────────────────────────────────────────
# better-sqlite3 ships prebuilt binaries for common platforms but falls back to
# a node-gyp compile (notably on musl), so the toolchain has to be present.
# It lives only in this stage and never reaches the final image.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

# ─── builder ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Deliberately no NEXT_PUBLIC_* build args. Next inlines those as build-time
# constants, which would bake one operator's hostname into an image everyone
# else pulls. All configuration is read from the environment at runtime
# instead — see lib/config.ts.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── runner ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SHH_DB_PATH=/data/secrets.db

# `node` (uid/gid 1000) ships with the base image. Matching uid 1000 is also
# the default for the first user on Raspberry Pi OS and most NAS setups, so a
# bind-mounted ./data usually just works.
RUN mkdir -p /data && chown -R node:node /data

# The standalone bundle carries its own minimal node_modules (including the
# native better-sqlite3 binding traced in via `serverExternalPackages`).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000
VOLUME ["/data"]

# Hits the app's own health route, which opens SQLite — so an unmounted or
# read-only /data shows up as unhealthy instead of as a working container that
# fails the first time someone stores a secret.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
