# Distribuili Van — APK packaging

One APK binary serves **all vans**. Each install is bound to its van by a
**device token** (Admin → Devices → register → token shown once).

## Prerequisites

- Deployed server reachable via HTTPS domain (e.g. `https://vente.votre-domaine.com`)
- Android Studio + SDK (for the final build), Node 20+

## 1. Install Capacitor (once)

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Distribuili Van" com.distribuili.van --web-dir=out-van
```

## 2. Point the app at the server

In `capacitor.config.ts`, set:

```ts
server: { url: "https://votre-domaine.com/ar/tournees", cleartext: false }
```

## 3. Build the APK shell

```bash
npx cap add android
npx cap sync android
# open android/ in Android Studio → Build → Generate Signed APK
```

No web build is bundled (`webDir` stays empty on purpose): the WebView loads
the live PWA, so updates deploy server-side with zero APK reinstalls.

## 4. Bind each van

1. Admin → Devices → register device (label + van + vendeur) → copy token
2. On the van phone, open the app with `?device=<token>` once
   (or paste it when the sync badge asks) — the token persists in localStorage
3. `vanBindingMode = LOCKED` pins that install to its van;
   `PICK` lets the vendeur choose a van at login (remembered on device)

## Offline behavior

- Opened pages keep working offline (service worker + cached shell)
- These actions queue in the **localStorage outbox** with idempotency IDs
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

- **Internet (default):** `server.url = "https://votre-domaine.com/..."`,
  `cleartext: false`; sync uses the same origin (`/api/sync`)
- **WiFi-local server:** point `server.url` at the LAN address, allow
  cleartext HTTP in the Capacitor config + rebuild, set
  `COOKIE_SECURE=false` on the server, and open the app once with
  `?sync=http://192.168.x.x:3000/api/sync` (persisted on device)

## Reconciliation (owner)

Devices page → per-device last sync, op history, failed ops + retry.
Inventory → alerts includes **negative stocks** (oversell) per location.
Journal → per-day, per-van sales.
