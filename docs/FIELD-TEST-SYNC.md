# Field test — Phone → PC sync (do once before delivery)

Goal: prove no sale / client / cash is lost or duplicated when the van phone
works offline then syncs. Tick each box with real phone + PC on same Wi-Fi.

## Setup (5 min)
- [ ] PC: depot has stock (product A ≥ 50, B ≥ 50). Note stock: A=__ B=__
- [ ] PC: van V1 bound to device D1 + vendeur U1 (`/devices`). Token on phone.
- [ ] PC: open tournée T for V1 with 2 clients. Note client balances: __
- [ ] Phone: open van app, first sync OK, `last sync` time noted: __

## Test 1 — offline sales then sync (core)
- [ ] Phone airplane ON. Create ticket T1 (client C1, 5×A cash) + ticket T2 (C2, 3×B credit).
- [ ] Phone airplane ON. Create NEW client C3 (name `TEST-SYNC-<time>`).
- [ ] Phone airplane ON. Collect versement 1000 DZD from C1.
- [ ] Outbox shows 4 pending. Kill app, reopen → still 4 pending.
- [ ] Airplane OFF → Sync. Result: applied=4 failed=0 remaining=0.
- [ ] PC `/sales`: T1+T2 exist, totals match phone, numbers unique.
- [ ] PC `/clients`: C3 exists with QR code kept from phone. C1 balance −1000.
- [ ] PC stock: A −5, B −3 exactly. No other move in `/journal`.
- [ ] Phone: pull shows same 2 sales + C3 with server id.

## Test 2 — retry / double sync (anti-duplicate)
- [ ] Phone: press Sync again immediately → uploaded=0, nothing duplicated on PC.
- [ ] Phone: airplane ON, create ticket T3. Sync with bad Wi-Fi (timeout). Retry → PC has T3 ONCE (`SyncOp` APPLIED ×1).

## Test 3 — PC changed data while phone offline (conflict)
- [ ] Phone airplane ON. PC: change price of A, add new product Z, deactivate product D.
- [ ] Phone: sell A (old price in snapshot) + sync.
- [ ] PC sale uses price at delivery (check which rule you promised client) — no crash.
- [ ] Phone after sync: new price of A, Z visible, D gone / unsellable.

## Test 4 — failure stays visible, never silent
- [ ] Phone airplane ON. Create client with duplicate phone of existing client.
- [ ] Sync → failed=1, error shown in phone history, op stays in outbox.
- [ ] PC: no duplicate client. Fix on phone (change phone) → resync OK.

## Test 5 — cash day close
- [ ] Phone: declare till (cash-declare) for today, amount = counted till.
- [ ] PC `/cash-daily`: declaration visible as DECLARED, expected vs declared diff shown.
- [ ] Admin closes day → phone re-sync: day shows CLOSED, no second declare allowed.

## Test 6 — device safety
- [ ] Revoke device on PC → phone sync gives clear auth error, outbox KEPT (not wiped).
- [ ] Re-activate → sync succeeds, backlog uploads.

## Sign-off
- Tester: __  Date: __  Phone model/Android: __  PC/Server: __
- Sync history screenshot saved: [ ]  Journal export saved: [ ]
- Bugs found: __
