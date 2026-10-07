#!/usr/bin/env bash
# Scaffold an isolated per-client deployment: own database, own port, own secrets.
#   bash scripts/new-client.sh <client> <domain> [port]
# Run on the server from the repo dir. Writes:
#   deploy/clients/<client>.env        secrets (gitignored — lives on the server only)
#   deploy/clients.conf                registry line "client domain port" (committed)
#   deploy/clients/<client>.nginx.conf rendered nginx vhost (committed)
set -euo pipefail

cd "$(dirname "$0")/.."

CLIENT="${1:-}"
DOMAIN="${2:-}"
PORT="${3:-}"
REGISTRY="deploy/clients.conf"
TEMPLATE="deploy/nginx-client.conf.template"

if [[ ! "$CLIENT" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]]; then
  echo "usage: bash scripts/new-client.sh <client> <domain> [port]" >&2
  echo "  client: lowercase letters/digits/dashes, e.g. client1" >&2
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "usage: bash scripts/new-client.sh <client> <domain> [port]" >&2
  exit 1
fi
[[ -f "$TEMPLATE" ]] || { echo "missing $TEMPLATE" >&2; exit 1; }
mkdir -p deploy/clients backups
touch "$REGISTRY"

if grep -qE "^${CLIENT} " "$REGISTRY" 2>/dev/null; then
  echo "client '$CLIENT' already in $REGISTRY" >&2
  exit 1
fi
if grep -qE " ${DOMAIN} " "$REGISTRY" 2>/dev/null; then
  echo "domain '$DOMAIN' already registered" >&2
  exit 1
fi

port_taken() {
  grep -qE " $1\$" "$REGISTRY" 2>/dev/null && return 0
  ss -ltn 2>/dev/null | grep -qE ":$1(\s|\$)" && return 0
  return 1
}
if [[ -z "$PORT" ]]; then
  PORT=3101
  while port_taken "$PORT" && [[ "$PORT" -lt 3200 ]]; do PORT=$((PORT + 1)); done
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || port_taken "$PORT"; then
  echo "port '$PORT' invalid or taken" >&2
  exit 1
fi

ENV_FILE="deploy/clients/${CLIENT}.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists — refusing to overwrite" >&2
  exit 1
fi

POSTGRES_PASSWORD="$(openssl rand -hex 16)"
JWT_SECRET="$(openssl rand -hex 32)"
# Same license authority for every client (vendor key). Copied from the root
# .env when present; otherwise left empty and the deploy will warn.
LICENSE_PRIVATE_KEY=""
if [[ -f .env ]]; then
  LICENSE_PRIVATE_KEY="$(grep -E '^LICENSE_PRIVATE_KEY=' .env | cut -d= -f2- | tr -d '"' || true)"
fi

cat > "$ENV_FILE" <<EOF
# Isolated deployment: ${CLIENT} (${DOMAIN}). NEVER COMMIT — chmod 600.
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
LOG_LEVEL=info
LICENSE_PRIVATE_KEY=${LICENSE_PRIVATE_KEY}
APP_PORT=${PORT}
APP_URL=http://127.0.0.1:${PORT}/api/health
EOF
chmod 600 "$ENV_FILE"

echo "${CLIENT} ${DOMAIN} ${PORT}" >> "$REGISTRY"

sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s/__PORT__/${PORT}/g" "$TEMPLATE" \
  > "deploy/clients/${CLIENT}.nginx.conf"

cat <<EOF

==> client '${CLIENT}' scaffolded
  env:      ${ENV_FILE}   (secrets, server-only)
  registry: ${REGISTRY}
  nginx:    deploy/clients/${CLIENT}.nginx.conf

Next (on the server):
  1. DNS: CNAME ${DOMAIN} -> your server (Cloudflare proxy ON).
  2. sudo cp deploy/clients/${CLIENT}.nginx.conf /etc/nginx/sites-enabled/${CLIENT}.conf
     sudo nginx -t && sudo systemctl reload nginx   # certbot adds the 443 block
  3. First deploy (migrations + seed):
       bash scripts/deploy-client.sh ${CLIENT} --seed
  4. Backups:  bash scripts/backup-docker.sh ${CLIENT}
  5. Auto-redeploy every 2 min:
       sudo cp deploy/distribuili-client@.service deploy/distribuili-client@.timer /etc/systemd/system/
       sudo systemctl enable --now distribuili-client@${CLIENT}.timer
  6. Point the client's apps at https://${DOMAIN}:
       desktop: node scripts/set-mode.mjs server https://${DOMAIN} && npm run electron:dist:server:mac
       APK:     capacitor.config.ts server.url + allowNavigation, then rebuild
EOF
if [[ -z "$LICENSE_PRIVATE_KEY" ]]; then
  echo "  !! LICENSE_PRIVATE_KEY is empty — desktop activations for ${CLIENT} will fail until you set it in ${ENV_FILE}" >&2
fi
