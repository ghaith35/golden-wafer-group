#!/usr/bin/env bash
# Per-client production deploy: pull → migrate → rebuild → health-check → rollback.
#   bash scripts/deploy-client.sh <client> [--seed]
# Run on the server from the repo dir. Uses deploy/clients/<client>.env and an
# isolated compose project (-p <client>: own containers, network, volumes/DB).
# --seed: first deploy only (migrations + demo company + admin user).
set -euo pipefail

cd "$(dirname "$0")/.."

CLIENT="${1:-}"
SEED="${2:-}"
ENV_FILE="deploy/clients/${CLIENT}.env"
if [[ -z "$CLIENT" || ! -f "$ENV_FILE" ]]; then
  echo "usage: bash scripts/deploy-client.sh <client> [--seed]" >&2
  echo "  (run bash scripts/new-client.sh first)" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
export CLIENT_ENV="$ENV_FILE"
export APP_PORT="${APP_PORT:?APP_PORT missing in $ENV_FILE}"
APP_URL="${APP_URL:-http://127.0.0.1:${APP_PORT}/api/health}"
COMPOSE="docker compose -p $CLIENT --env-file $ENV_FILE -f docker-compose.prod.yml"

echo "==> [${CLIENT}] git pull"
git pull --ff-only origin master

if [[ "$SEED" == "--seed" ]]; then
  echo "==> [${CLIENT}] first deploy: migrate + reference seed (no demo — owner onboards via /onboard)"
  SEED_DEMO=0 $COMPOSE --profile tools run --rm seed
else
  echo "==> [${CLIENT}] migrate"
  $COMPOSE --profile tools run --rm migrate
fi

echo "==> [${CLIENT}] rebuild + up"
$COMPOSE up -d --build app db

echo "==> [${CLIENT}] health check ${APP_URL}"
OK=0
for _ in $(seq 1 30); do
  if curl -sf -m 5 "$APP_URL" > /dev/null; then OK=1; break; fi
  sleep 4
done

if [ "$OK" = "1" ]; then
  echo "==> [${CLIENT}] healthy"
  docker image prune -f > /dev/null 2>&1 || true
  exit 0
fi

echo "==> [${CLIENT}] UNHEALTHY — rolling back to previous image"
$COMPOSE up -d --no-build app || true
exit 1
