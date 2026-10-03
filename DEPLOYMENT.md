# Deploying Distribuili

## Home server / VPS (Docker Compose + auto-redeploy)

Fastest path to an always-on server (also the license authority + APK sync
endpoint + web app). Runs app + PostgreSQL in Docker, auto-redeploys on every
push to `main` via a polling systemd timer.

```bash
# On the server (e.g. ~/distribuili):
git clone <repo> ~/distribuili && cd ~/distribuili

# Secrets (never committed):
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
LOG_LEVEL=info
COOKIE_SECURE=false
LICENSE_PRIVATE_KEY="<from: node scripts/gen-license-keys.mjs>"
EOF
chmod 600 .env

# First deploy: migrate + seed, then bring up the stack.
docker compose -f docker-compose.prod.yml --profile tools run --rm seed
docker compose -f docker-compose.prod.yml up -d --build app db

# Auto-redeploy (polls main every 2 min) — see scripts/deploy.sh:
#   sudo cp deploy/distribuili-deploy.{service,timer} /etc/systemd/system/
#   sudo systemctl enable --now distribuili-deploy.timer
```

App: `http://<server-ip>:3002`. Login: `gayethtayem@gmail.com / ghaith` (change immediately).

**Migrations:** the history is `migrate deploy`-clean (verify anytime with
`npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --script`
→ must print "empty migration"). Note: `migrate dev` needs a TTY when it shows
warnings — in this sandbox use the manual diff flow instead:
generate the SQL into `prisma/migrations/<date>_<name>/migration.sql`, then
`migrate deploy`. Never hand-edit the Wilaya table name: history contains a
one-time `wilayas` → `Wilaya` case rename; final state is `Wilaya` everywhere.

**HTTP (no TLS):** `COOKIE_SECURE=false` is required over plain `http://` —
otherwise the browser drops the session cookie and login silently fails.
Remove it behind HTTPS (reverse proxy), and set the real domain so the APK
sync (`https://domain/api/sync`) and portal work.

**Backups:** `bash scripts/backup-docker.sh` (pg_dump → `./backups`, newest 14).
Restore command is printed at the bottom of that script.

## Desktop (Electron)

Two products from one codebase (selected by `build-mode.json` at pack time):

| Mode | Build | Use case |
|---|---|---|
| `server` (default) | thin client → your domain | Shop PCs with internet/LAN |
| `local` | offline SQLite desktop | Single machine, no network |

```bash
node scripts/set-mode.mjs server https://votre-domaine.com   # or: local
npm run electron:dist:mac   # / :win
```

Desktop-only licensing (Jafraa pattern, see `docs/LICENSE.md`):
activation/trial via the server above; updates accepted from
Settings → Updates (never silent).

> **Offline-SQLite status:** the `local` Electron shell + server lifecycle are
> wired, but the Prisma Postgres schema has not yet been ported to the
> libSQL/SQLite dialect (Jafraa's `gen-sqlite-schema` equivalent). Until that
> port lands, ship desktop as `server` thin clients. The port is the next
> tracked work item — schema translation + per-query verification.

## Phone (APK per van)

PWA wrapped via Capacitor — see `docs/APK.md`. Phones sync to
`https://<domain>/api/sync`; each APK is bound to its van by device token
(Admin → Devices).

## First-run checklist

1. Change `admin` + `superadmin` passwords (Users page, `/superadmin` equivalent
   is the license console at `/license` for keys)
2. Settings → toggles for the business (units, tiers, credit, remise, depots…)
3. Products → Purchases → Clients → Vans → Tournées
4. Devices: register each van APK; Licenses: mint keys for desktop installs
5. Backups cron + systemd deploy timer
