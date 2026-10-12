# Distribuili Van — APK packaging

One APK binary serves **all clients and all vans** (universal build). Each
install is bound once to its client's server **and** its van, then stays
connected with no rescan:

1. Driver installs the APK → bundled launcher (offline page, no server hardcoded).
2. Admin configures the client's public HTTPS tunnel domain in the superadmin
  company record. Devices shows one reusable server QR containing only that
  HTTPS origin; scan the same QR on every phone.
3. The phone opens the driver's login page. After login, first Sync → Direct
  pair creates a unique device token and binds it to that driver's assigned
  van. The server URL is shared; device identity remains unique per phone.
4. Every later launch auto-connects to the stored server. To move the phone to
   another server: Sync → **Server** → scan the new QR (blocked while ops are
   pending — sync or discard first; queued ops are tagged per server and never
   upload to a different one).

## Prerequisites

- Public HTTPS tunnel routed to the app server port (e.g.
  `https://dist-client1.khiatadz.com` → local port `32517`)
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
  allowNavigation: ["khiatadz.com", "*.khiatadz.com"],
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

1. Configure the HTTPS tunnel domain for the company in the superadmin record.
2. Admin → Settings → Devices → keep the shared server QR visible; every phone
  scans this same code and signs in with its own driver account.
3. First Sync → Direct pair binds the phone to the driver's van and issues a
  unique device token for **that client's database**.
3. `vanBindingMode = LOCKED` pins that install to its van;
   `PICK` lets the vendeur choose a van at login (remembered on device)

## Offline behavior

- Opened pages keep working offline (service worker + cached shell)
- **Server unreachable, phone online** (tunnel down, shop PC off): the
  launcher probes the shop server first — no answer enters today's cached
  dashboard directly instead of looping on the error page; the error page
  also has a dedicated "دخول لوحة اليوم دون اتصال" button. Snapshot +
  outbox keep the journée working; ops auto-flush on the next sync
- These actions queue in the **on-device outbox** (native SQLite, idempotency IDs)
  when the network drops: sale tickets, client payments (versements),
  transfer declarations, transfer receipt confirmations
- **Queued tickets/orders stay visible** in Factures/Commandes with an
  unsynced badge — openable, printable (A4 PDF) and shareable before sync;
  discarding one drops the queued op. Synced docs opened online reopen
  offline from cache (stale banner) so deliver/cancel/print keep working
- **Debt collection from the van** (client card): queue-only by design
  (staff APIs stay 403), flushed immediately when online
- **Transfer receipt is admin-only**: drivers request restock, the admin
  validates in vans/orders — no van-side approval, so a driver can never
  approve his own request
- **Vendeur (mandob)**: orders-only flow verified offline — create/deliver/
  collect queue; sale creation, factures, cancel/reopen stay forbidden
  (server + engine + UI gates) with a localized message instead of an error
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

## Publishing a new APK (OTA update feed)

1. Bump `versionCode`/`versionName` in `android/app/build.gradle`.
2. `npx cap sync android` (only needed for `out-van/`/`capacitor.config.ts`
   changes) → `./gradlew assembleDebug` in `android/`.
3. Copy the APK in place **and stamp its version** (the server never ships
   `android/`, so without this file `/api/apk-info` keeps reporting the
   previous version forever):
   ```bash
   cp android/app/build/outputs/apk/debug/app-debug.apk public/apk/Distribuili-Van.apk
   printf '{"versionCode": 11, "versionName": "1.10"}\n' > public/apk/version.json
   ```
   (Replace 11/1.10 with the values from step 1.)
4. Deploy web (`live-patch` / server deploy) — `public/` ships with it.
