#!/usr/bin/env bash
# Polling auto-deploy for server C (no source checkout).
# Pulls the prebuilt GHCR images; when the app digest changes: migrate ->
# restart -> health-check. Idempotent — a no-op when images are unchanged.
# Triggered by deploy/golden-wafer-registry.timer (every 2 min).
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."   # deploy dir (/home/ghaith/apps/golden-wafer-group)
[ -f .env ] && set -a && . ./.env && set +a || true
COMPOSE="docker compose -f docker-compose.registry.yml"
PORT="${GW_PORT:-32517}"
APP_IMAGE="ghcr.io/ghaith35/golden-wafer-group/app:latest"

# Single-flight: a slow deploy must never overlap the next timer tick.
exec 9>/tmp/golden-wafer-deploy.lock
flock -n 9 || exit 0

BEFORE=$(docker inspect --format='{{.Id}}' "$APP_IMAGE" 2>/dev/null || echo none)
$COMPOSE pull app migrate
AFTER=$(docker inspect --format='{{.Id}}' "$APP_IMAGE" 2>/dev/null || echo none)
[ "$BEFORE" = "$AFTER" ] && exit 0   # nothing new to deploy

echo "[$(date -Is)] Deploying ${BEFORE:0:12} -> ${AFTER:0:12}"
$COMPOSE --profile tools run --rm migrate
$COMPOSE up -d app db

# Health check; the previous image is kept. Roll back with:
#   docker tag <previous-image-id> ghcr.io/ghaith35/golden-wafer-group/app:latest && docker compose -f docker-compose.registry.yml up -d app
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    docker image prune -f >/dev/null 2>&1 || true
    echo "[$(date -Is)] Deploy OK (${AFTER:0:12})"
    exit 0
  fi
  sleep 2
done
echo "[$(date -Is)] HEALTH CHECK FAILED — rolling back to ${BEFORE:0:12}"
if [ "$BEFORE" != "none" ]; then
  docker tag "$BEFORE" "$APP_IMAGE"
  $COMPOSE up -d app
fi
exit 1
