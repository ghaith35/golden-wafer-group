# Distribuili Van — APK packaging

One APK binary serves **all clients and all vans** (universal build). Each
install is bound once to its client's server **and** its van, then stays
connected with no rescan:

1. Driver installs the APK → bundled launcher (offline page, no server hardcoded).
2. Admin → Devices → register device (label + van + vendeur) → **scan the setup QR**.
   The QR carries the server origin + device token; the launcher stores the
   server and jumps straight into the app (`?device=` hands the token over —
   WebView storage is per-origin).
3. Every later launch auto-connects to the stored server. To move the phone to
   another server: Sync → **Server** → scan the new QR (blocked while ops are
   pending — sync or discard first; queued ops are tagged per server and never
   upload to a different one).

## Prerequisites

- Deployed server reachable via HTTPS domain (e.g. `https://vente.votre-domaine.com`)
- Android Studio + SDK (for the final build), Node 20+

## 1. Install Capacitor (once)

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Distribuili Van" com.distribuili.van --web-dir=out-van
```

## 2. Navigation allow-list

`capacitor.config.ts` has **no** `server.url` (launcher boots first) and allows
the apex domain plus every client subdomain (`*` matches exactly one label):

```ts
server: {
  cleartext: false,
  allowNavigation: ["distribuili.khiatadz.com", "*.distribuili.khiatadz.com"],
}
```

(Locked single-client builds are still possible by re-adding
`server: { url: "https://client1…", ... }`.)

## 3. Build the APK shell

```bash
npx cap add android
npx cap sync android
# open android/ in Android Studio → Build → Generate Signed APK
```

`npx cap sync` bundles `out-van/` (the launcher) and regenerates
`android/app/src/main/assets/capacitor.config.json` — rerun it after any
`capacitor.config.ts` / `out-van/` change. Only the launcher is bundled: the
WebView loads the live app from the bound server, so updates deploy
server-side with zero APK reinstalls.

## 4. Bind each van

1. Admin → Devices → register device (label + van + vendeur) → scan the setup QR
   (shown once — it carries the server origin + token, old `/api/sync` QRs still scan)
2. First sync binds phone → van → **that client's database**. Device tokens are
   per-server: a client1 token is rejected anywhere else.
3. `vanBindingMode = LOCKED` pins that install to its van;
   `PICK` lets the vendeur choose a van at login (remembered on device)

## Offline behavior

- Opened pages keep working offline (service worker + cached shell)
- These actions queue in the **on-device outbox** (native SQLite, idempotency IDs)
  when the network drops: sale tickets, client payments (versements),
  transfer declarations, transfer receipt confirmations
- The sync badge shows pending count, auto-flushes on reconnect, and pulls
  fresh stock, prices, transfers, tournées
- Failed ops stay visible under Devices → device → failed ops, with one-tap
  retry after the owner fixes the cause (e.g. stock, credit limit)

## Transfer confirmations

- Setting `transferConfirmRequired` (Sales settings, default ON):
  - **ON** — depot declares, the van confirms receipt from the phone
    (`transfer-confirm` op); Admin or the destination-van owner can confirm
  - **OFF** — the declaration delivers straight to the destination
    (single-step, no confirmation)

## Server reachability: internet vs WiFi-local

- **Internet (default):** scan the server QR (`https://client1…`);
  `cleartext: false`; sync uses the same origin (`/api/sync`)
- **WiFi-local server:** type/scan the LAN address in the launcher
  (`http://192.168.x.x:3000`), allow cleartext HTTP in a debug build,
  set `COOKIE_SECURE=false` on the server. The binding is stored the same way.

## Reconciliation (owner)

Devices page → per-device last sync, op history, failed ops + retry.
Inventory → alerts includes **negative stocks** (oversell) per location.
Journal → per-day, per-van sales.
