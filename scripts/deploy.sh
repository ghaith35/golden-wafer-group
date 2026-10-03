#!/usr/bin/env bash
# Distribuili production deploy: pull → migrate → rebuild → health-check → rollback.
# Run on the server from the repo dir (see DEPLOYMENT.md / systemd timer below).
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
# Host port + health URL follow APP_PORT (default keeps the old 3002).
# e.g. APP_PORT=3005 bash scripts/deploy.sh
export APP_PORT="${APP_PORT:-3002}"
APP_URL="${APP_URL:-http://127.0.0.1:${APP_PORT}/api/health}"

echo "==> git pull"
git pull --ff-only origin master

echo "==> migrate"
$COMPOSE --profile tools run --rm migrate

echo "==> rebuild + up"
$COMPOSE up -d --build app db

echo "==> health check"
OK=0
for i in $(seq 1 30); do
  if curl -sf -m 5 "$APP_URL" > /dev/null; then OK=1; break; fi
  sleep 4
done

if [ "$OK" = "1" ]; then
  echo "==> healthy"
  docker image prune -f > /dev/null 2>&1 || true
  exit 0
fi

echo "==> UNHEALTHY — rolling back to previous image"
$COMPOSE up -d --no-build app || true
exit 1
