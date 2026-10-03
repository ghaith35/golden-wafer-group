# WiFi-local sync test (no domain, no APK)

Phone + this Mac on the **same WiFi**. The phone uses Chrome (no build needed);
the APK + domain phase comes later with the same flow.

## 1. Start the server (on the Mac)

```bash
npm run dev
```

It listens on all interfaces (`*:3000`). No `.env` change needed in dev:
cookies are non-secure when `NODE_ENV=development`, so plain-HTTP login works.

If macOS asks, allow incoming connections for Node.

## 2. Phone URL

On the phone (same WiFi), open the stable address (mDNS — survives DHCP IP changes):

```
http://ghaith.local:3000/ar/login
```

Login as vendeur once to confirm reachability (if it loads, the network path is good).
Fallback if `.local` doesn't resolve on an old phone: use the Mac LAN IP
(`ipconfig getifaddr en0`, currently `192.168.100.47`) — but prefer `.local`.

## 3. Bind the van device

1. On desktop: Devices → register (label + van + vendeur) → copy the token
2. On the phone, open once:
   ```
   http://ghaith.local:3000/ar/tournees?device=<TOKEN>
   ```
   The token persists on the phone; the sync badge appears.

## 4. Sync test matrix

1. **Offline sell**: phone airplane mode → sell a ticket → airplane off → badge auto-flushes, count drops
2. **Declare load**: phone declares depot→van transfer → desktop journal shows DECLARED (amber)
3. **Confirm**: confirm on desktop (or from the phone) → van stock + board + last-sync update
4. **Server → phone**: desktop sells/transfers → phone syncs → pulled stock updates
5. **Failure path**: oversell on the phone → Devices → failed ops → fix cause → retry

## 5. On-device database (APK)

The phone keeps its **own SQLite database** (`distribuili-van.db` via
`@capacitor-community/sqlite`; localStorage with identical keys on web/PWA):
- `kv` table: catalog snapshot (products, clients, prices, colisage, van stock),
  tokens, last-sync time
- `outbox` table: queued ops with retry bookkeeping (`attempts`, `nextRetryAt`,
  30s → 5min exponential backoff)

Selling works with **zero connection**: the ticket screen falls back to the
snapshot (amber "offline mode" banner), queues the ticket, and flushes on
reconnect. Server ops stay idempotent per `opId`, so retries never duplicate.
Product photos precache after each sync for offline display.

## 6. Later: domain phase

Same flow, different origin: deploy to `distribuili.khiatadz.com` (HTTPS),
build the APK pointed at it, install the dmg in server mode. Nothing in the
sync protocol changes — only the URL and TLS.
