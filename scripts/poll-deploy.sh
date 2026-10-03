#!/usr/bin/env bash
# Auto-deploy poller — installed as a cron job on the server:
#   */2 * * * * /home/ghaith/distribuili/scripts/poll-deploy.sh
# Pulls origin/master; when it moved, runs the full deploy (migrate +
# rebuild + health-check + rollback). Logs to logs/auto-deploy.log.
set -euo pipefail

# Single-flight: cron every 2 min must never overlap a running deploy
# (or a manual one) — second runner exits quietly.
exec 9>"${REPO_LOCK:-/tmp/distribuili-deploy.lock}"
flock -n 9 || exit 0

REPO="${REPO:-/home/ghaith/distribuili}"
export APP_PORT="${APP_PORT:-3005}"
cd "$REPO"

git fetch origin -q
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "==> $(date -u +%FT%TZ) new commits $LOCAL..$REMOTE — deploying"
# shellcheck disable=SC1091
bash scripts/deploy.sh >> logs/auto-deploy.log 2>&1
echo "==> $(date -u +%FT%TZ) deploy exit: $?" >> logs/auto-deploy.log

# auto-deploy active since 2026-10-03
