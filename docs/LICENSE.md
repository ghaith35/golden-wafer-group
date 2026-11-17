# Desktop licensing + vendor console

Desktop-only (web and APKs authenticate by login — no machine license).

## One-time setup (vendor)

```bash
node scripts/gen-license-keys.mjs
# → LICENSE_PRIVATE_KEY="..."  → server .env (secret, never commit)
# → public key                   → baked automatically at package time
#   (scripts/electron-prepare.mjs injects it into electron/dist/license.js
#   from LICENSE_PUBLIC_KEY or LICENSE_PRIVATE_KEY env — a packaged EXE
#   without a key warns loudly and stays license-inert)
```

Until the real key is baked in, desktop builds run with a **dev bypass**
(entitled, banner in activation screen). Never ship bypass builds to customers.

## Vendor superadmin console (`/superadmin`, central install only)

Separate login (own users table + 4h cookie, forced rotation on first login):
**Dashboard** (machines by status, expiring trials) · **Licenses** (machines:
activate/unrevoke/**revoke**/end-trial/reset/edit/delete; key pool: bulk
mint/revoke/reset; blocked IPs) · **Companies** (provision company + admin) ·
**Audit** (who did what, 20/page). Every action is audit-logged with IP.

First superadmin: `npx tsx --env-file=.env scripts/make-superadmin.ts <user> <pass>`

## Selling a license

Superadmin (or company Admin → Licenses page):
- **Mint key** → `XXXXX-XXXXX-XXXXX-XXXXX` (Crockford 4×5; old `DILI-` keys keep
  verifying). Pool = first device wins, or pre-bind a machineId.
- Customer redeems in the app (Activate screen) → machine-bound signed token.
- **Revoke** → install wipes tokens, sets the encrypted sticky flag, drops
  to /activate within ~30s when online. Survives offline AND file restores —
  only a fresh server token (unrevoke) resurrects it.
- **Trial**: 14 days, one per machine, DZ-mobile-gated, IP-abuse-blocked,
  clock-rollback resistant.

Machine endpoints (called by the Electron shell, no staff session):
`POST /api/license/register|trial|activate|redeem`, `GET /api/license/status`
(unified poll: `{status: pending|active|revoked, token?, trialEndsAt?}`).
Rate-limited; blocked IPs get silent-ok/403 on register/trial only.

### Server-side activation request diagnostics

On server-c, license requests pass through nginx so their HTTP results can
be inspected without access to the customer's PC. Install
`deploy/nginx-license-log-format.conf` in `/etc/nginx/conf.d/`, and install
`deploy/nginx-license-location.conf` in `/etc/nginx/snippets/`, included
inside both nginx server blocks for `distribuili.khiatadz.com`.
The Cloudflare ingress rule that sends `/updates/.*` to port 80 must also
send `/api/license/.*` there (path: `/(updates/.*|api/license/.*)`). All other
app traffic continues to use port 3005.

Validate with `nginx -t` and `cloudflared tunnel ingress validate` before
reloading nginx and restarting cloudflared. Keep backups of both configs.
Results are recorded in `/var/log/nginx/distribuili-license.access.log`:
timestamp, request ID, method, path, HTTP/upstream status, duration, and
Cloudflare Ray ID. Keys, tokens, client IPs, and query strings are excluded.
An HTTP 200 on redeem means the server responded successfully; it does not
prove the desktop accepted or saved the token. No log entry on a retry
means the request did not reach this proxy.

## Local-install gate (teeth)

On Electron local installs (`DISTRIBUILI_DB=local`, public key baked):
- Staff pages steer to `/activate` when unentitled (layout gate).
- All `/api/*` except license/health/auth/apk-info answer **402 not_entitled**
  (proxy gate, 5s cache) — a locked shop's vans stop syncing too.
- Central/vendor installs and plain dev servers are never gated.

## Updates (manual accept)

Settings → Updates: **Check → Download (progress) → Install & Restart**.
Never silent, never forced (electron-updater, `autoDownload=false`).

Feed: baked `publish.url` in electron-builder.yml, overridable per install
via `DISTRIBUILI_UPDATE_URL` or `<userData>/update-feed.json`.
Publish with `node scripts/upload-update.mjs` and serve `latest.yml`
with `Cache-Control: no-cache`.
