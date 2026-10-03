#!/usr/bin/env bash
# Container-based pg_dump backup (the host has no node_modules).
#   bash scripts/backup-docker.sh
# Keeps the newest 14 dumps in ./backups.
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="backups/distribuili-${STAMP}.sql.gz"

$COMPOSE exec -T db pg_dump -U distribuili distribuili | gzip > "$FILE"
echo "wrote $FILE"

ls -1t backups/distribuili-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "retention: newest 14 kept"

# Restore example:
#   gunzip -c backups/<file> | docker compose -f docker-compose.prod.yml exec -T db psql -U distribuili distribuili
