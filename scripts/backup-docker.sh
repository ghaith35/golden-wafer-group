#!/usr/bin/env bash
# Container-based pg_dump backup (the host has no node_modules).
#   bash scripts/backup-docker.sh [client]
# No arg → main deployment. With a client name → that client's isolated DB
# (deploy/clients/<client>.env). Keeps the newest 14 dumps per deployment.
set -euo pipefail

CLIENT="${1:-}"
if [[ -n "$CLIENT" ]]; then
  ENV_FILE="deploy/clients/${CLIENT}.env"
  [[ -f "$ENV_FILE" ]] || { echo "unknown client '$CLIENT'" >&2; exit 1; }
  export CLIENT_ENV="$ENV_FILE"
  COMPOSE="docker compose -p $CLIENT --env-file $ENV_FILE -f docker-compose.prod.yml"
  PREFIX="$CLIENT"
else
  COMPOSE="docker compose -f docker-compose.prod.yml"
  PREFIX="distribuili"
fi

mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="backups/${PREFIX}-${STAMP}.sql.gz"

$COMPOSE exec -T db pg_dump -U distribuili distribuili | gzip > "$FILE"
echo "wrote $FILE"

ls -1t "backups/${PREFIX}-"*.sql.gz | tail -n +15 | xargs -r rm -f
echo "retention: newest 14 kept for ${PREFIX}"

# Restore example:
#   gunzip -c backups/<file> | docker compose -p <client?> -f docker-compose.prod.yml exec -T db psql -U distribuili distribuili
