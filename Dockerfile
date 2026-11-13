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
# Standalone tracing can miss transitive deps (e.g. xtend/mutable via pg);
# fill in anything absent without overwriting traced modules.
COPY --from=builder /app/node_modules /tmp/nm_full
RUN cp -rn /tmp/nm_full/. ./node_modules/ && rm -rf /tmp/nm_full
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
