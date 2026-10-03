# Desktop licensing + updates

Desktop-only (web and APKs authenticate by login — no machine license).

## One-time setup (seller)

```bash
node scripts/gen-license-keys.mjs
# → LICENSE_PRIVATE_KEY="..."  → server .env (secret, never commit)
# → public key                   → paste into electron/license.ts
#   DISTRIBUILI_LICENSE_PUBLIC_KEY_DER_B64
```

Until the real key is baked in, desktop builds run with a **dev bypass**
(entitled, banner in activation screen). Never ship bypass builds to customers.

## Selling a license

Admin → Licenses page (or API):
- **Mint key** → `DILI-XXXX-XXXX-XXXX` (pool = first device wins, or pre-bind
  a machineId)
- Customer redeems in the app (Activate screen) → machine-bound signed token
- **Revoke** → the install drops to /activate within ~30s when online;
  the revocation flag survives offline token replanting
- **Trial**: 14 days, one per machine, clock-rollback resistant

Machine endpoints (called by the Electron shell, no staff session):
`POST /api/license/register|trial|activate|redeem`, `GET /api/license/status`.

Point an install at another license server via `DISTRIBUILI_LICENSE_URL` env
or `<userData>/license-server.json {"url": "..."}`.

## Updates (manual accept)

Settings → Updates: **Check → Download (progress) → Install & Restart**.
Never silent, never forced (electron-updater, `autoDownload=false`).

Feed: baked `publish.url` in electron-builder.yml, overridable per install
via `DISTRIBUILI_UPDATE_URL` or `<userData>/update-feed.json`.
Publish with `node scripts/upload-update.mjs` and serve `latest.yml`
with `Cache-Control: no-cache`.
