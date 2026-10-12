# Offline Contract — livreur & vendeur (van phones)

Every user-facing modification MUST satisfy this contract, or state loudly
in the UI why it can't. "Works offline" means: zero connection, both roles,
no dead buttons, no raw error keys, no data loss. Verified, not assumed.

## The non-negotiables (discovered the hard way)

1. **Staff are 403 on `/api/transfers*` and `/api/versements*`** (cost leak).
   Phone flows there are QUEUE-ONLY by design — never add a direct fetch.
2. **Ticket edits are online-only** — the engine has no edit op. Any edit
   UI fails LOUD with the offline message, never silently.
3. **`navigator.onLine` lies** (wifi on + server dead reads "online"). All
   navigation decisions go through `goPage()` / `serverUnreachable()`.
4. **New routes must be warmed** — add every driver-reachable URL to
   `warmJourneePages()`, or it 404s offline on first visit.
5. **New lazy chunks must be warmed** in `warmOfflineChunks()` — or bundled
   static if small. An uncached chunk fails exactly when the driver needs it.
6. **Role gates live in 4 layers**: proxy → API → `queueOp` → engine → UI.
   A new action needs all layers that apply; UI hides, others enforce.
   Unknown roles default to the most restricted view.
7. **All user-facing errors are localized** (`saleErrText` + `queueErrText`
   mapping; new keys in ar/fr/en). Raw snake_case in the UI is a bug.
8. **Snapshot is optional, never required** — every reader falls back
   (SSR props → snapshot → pending → honest "sync first" message).
9. **The SW never synthesizes HTML for assets** — a cache-missed chunk
   rejects honestly (import `.catch()` degrades) instead of serving the
   offline page as JS (`Unexpected token '<'` poisoning). Documents keep
   the offline-page fallback; `/_next/static`, `/fonts` and friends reject.

## Per-area rules

- **Sales & tickets**: create = fetch → catch → `queueOp("ticket")` + local
  preview. Guard failures go through `saleErrText`. Queued docs appear in
  Factures (badge → open → print PDF → share → discard).
- **Orders & delivery**: same queue pattern. Deliver needs a server id —
  pending rows say `syncFirst`. Cancel/reopen hide for Vendeur
  (`canSell(role)`), discard of own pending stays allowed.
- **Stock & transfers**: display from snapshot + pending effects. Receipt
  (`transfer-confirm`/`-reject`) is queue-only + opportunistic `syncNow()`.
- **Payments & debts**: collection (`versement`) is queue-only + opportune
  sync. Credit/stock guards in `offline-rules.ts` must mirror the server.
- **Journée & stamps**: stamps queue (`day-start`/`day-finish`); engine
  find-or-creates the tour. New journée pages join `warmJourneePages()`.
- **Sync & engine**: a new op kind needs ALL of — `validation.ts` kind +
  `queueOp` call site + engine `applyOp` branch + idempotency (opId unique)
  + `sortOutbox` priority + role gates + a unit test.
- **Login & roles**: unlock TTL stays aligned with credential TTL; new
  staff pages need proxy + UI gates; QR login stays online-only.

## Verification gates (before any live-patch)

1. `npx tsc --noEmit` clean.
2. `npx vitest run` green (new logic ⇒ new unit test).
3. e2e on the isolated env — **fixture first, always**:
   `stop :3000 → bash scripts/e2e-fixture.sh (asserts clean) → start :3000` →
   `offline-journee` + `offline-pending-docs` + `offline-workflows` +
   `offline-vendeur` — all green, zero pageerrors. Specs mutate the shared
   throwaway DB (deliveries flush, clients get renamed); reruns without a
   fixture reset fail on dirty state, never on app regressions.
4. New flows get e2e steps (queue → visible → open → print/share →
   discard), not just unit tests.
5. `live-patch` only after 1–4. Native/out-van changes need a full
   `dist:client` rebuild + APK version bump instead.

## Known network-bound (do not "fix", do message)

First sync, WhatsApp transport, map tiles, QR-code login, APK/web
updates, ticket edits, new secteurs, phone-clock skew (warn, don't block).
