# syntax=docker/dockerfile:1

# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder: generate client + build standalone; also the migrate/seed image ─
FROM node:24-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build is fully dynamic (no DB access); a placeholder keeps generate happy.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV SHADOW_DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm run db:generate \
 && npm run build
# Stage the runtime-only deps that standalone tracing misses (the pg tree,
# dynamically required through @prisma/adapter-pg: xtend etc. never traced).
# Staged separately so the runner stays slim (~0.5GB, like zz-sanitaire).
RUN mkdir -p /tmp/nm_extra/@prisma && for p in pg pg-connection-string pg-int8 pg-pool pg-protocol pg-types pgpass postgres-array postgres-bytea postgres-date postgres-interval xtend; do cp -r ./node_modules/$p /tmp/nm_extra/ 2>/dev/null || true; done && for p in client adapter-pg adapter-libsql; do cp -r ./node_modules/@prisma/$p /tmp/nm_extra/@prisma/ 2>/dev/null || true; done && cp -r ./node_modules/.prisma /tmp/nm_extra/ 2>/dev/null || true && ls /tmp/nm_extra /tmp/nm_extra/@prisma

# ── migrator: tiny image that only applies Prisma migrations ──────────────────
# Pushed by CI next to the app image; the server runs it before each restart.
FROM node:24-slim AS migrator
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# Config requires SHADOW_DATABASE_URL at load; only `migrate dev` uses it.
ENV SHADOW_DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm ci \
 && npm cache clean --force
CMD ["sh", "-c", "npx prisma migrate deploy"]

# ── runner: minimal production image ──────────────────────────────────────────
FROM node:24-slim AS runner
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Standalone tracing misses transitive deps (e.g. xtend via pg, dynamically
# required through @prisma/adapter-pg). Merge the staged pg subtree without
# overwriting traced modules — never the full node_modules (that was 3.98GB).
COPY --from=builder /tmp/nm_extra /tmp/nm_extra
RUN mkdir -p ./node_modules && cp -rn /tmp/nm_extra/. ./node_modules/ && rm -rf /tmp/nm_extra
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
