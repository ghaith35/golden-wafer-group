#!/usr/bin/env bash
# Hermetic e2e fixture: rebuild the throwaway test DB from the live server DB
# + fixed test rows. Run BEFORE the offline e2e suite (the specs mutate data:
# deliveries flush, clients get renamed — reruns need a reset).
#
#   1. stop the :3000 test server (it holds the file open)
#   2. bash scripts/e2e-fixture.sh
#   3. start the :3000 server, run the specs
#
# Requires: sqlite3 CLI. Never touches the live DB (backup API, read-only).
set -euo pipefail

LIVE="$HOME/Library/Application Support/distribuili/distribuili.db"
TEST="/tmp/e2e-test.db"
if [[ ! -f "$LIVE" ]]; then
  echo "live DB not found at $LIVE" >&2
  exit 1
fi

sqlite3 "$LIVE" ".backup '$TEST'"
echo "backup ok"

# bcrypt(test1234), test-only password for both staff logins.
HASH='$2b$10$SNn0qSv11O7vqc.C3Cmr/ezzc2nKhUfJ3.Qwb/V90mdctoGkzYR0q'

sqlite3 -bail "$TEST" <<SQL
-- Test-run residue from previous suites (the backup is pristine live data;
-- these tables are write-only history/pairing in the throwaway copy).
DELETE FROM sync_ops;
DELETE FROM devices;
DELETE FROM refresh_tokens;

UPDATE users SET passwordHash='$HASH', passwordView='test1234' WHERE username IN ('ghaith','vendeur1');
-- Admin test login for the admin-side e2e steps (van requests board).
UPDATE users SET passwordHash='$HASH', passwordView='test1234' WHERE role='Admin' AND username='ghaith@gmail.com';

-- vendeur1 (Vendeur) — insert when missing (fresh backups won't have him).
INSERT INTO users (id, companyId, username, passwordHash, passwordView, fullName, role, isActive, createdAt, updatedAt)
SELECT 'e2evendeur00000000000001', c.id, 'vendeur1', '$HASH', 'test1234', 'Vendeur Test', 'Vendeur', 1, datetime('now'), datetime('now')
FROM companies c WHERE NOT EXISTS (SELECT 1 FROM users WHERE username='vendeur1');

-- Second van for the vendeur (one driver ↔ max one van).
INSERT INTO stores (id, companyId, name, kind, userId, isActive, createdAt, updatedAt)
SELECT 'e2evan200000000000000001', u.companyId, 'Camion Vendeur', 'VAN', 'e2evendeur00000000000001', 1, datetime('now'), datetime('now')
FROM users u WHERE u.username='vendeur1' AND NOT EXISTS (SELECT 1 FROM stores WHERE id='e2evan200000000000000001');

-- Saturday tour + stop for van2.
INSERT INTO tournees (id, companyId, date, locationId, status, createdAt)
SELECT 'e2etourvendeur0000000001', s.companyId, '2026-10-10T23:00:00.000Z', 'e2evan200000000000000001', 'OPEN', datetime('now')
FROM stores s WHERE s.id='e2evan200000000000000001' AND NOT EXISTS (SELECT 1 FROM tournees WHERE id='e2etourvendeur0000000001');
INSERT INTO tournee_stops (id, tourneeId, clientId, position, visited, sold, skipped, total)
SELECT 'e2etourstopvend000000001', 'e2etourvendeur0000000001', c.id, 0, 0, 0, 0, 0
FROM customers c WHERE c.code='CLT-0001' AND NOT EXISTS (SELECT 1 FROM tournee_stops WHERE id='e2etourstopvend000000001');

-- CONFIRMED order for the deliver test (reset to CONFIRMED every run).
-- Delivery children (sourceId) must go first: the self-FK blocks the parent
-- delete, and a silent FK failure here once cost a day of debugging (the row
-- stayed DELIVERED and every later run failed). sqlite3 -bail makes any
-- future failure loud instead of lying with "fixture ok".
DELETE FROM sale_lines WHERE saleId IN (SELECT id FROM sales WHERE sourceId='e2eordervendeur000000001');
DELETE FROM sales WHERE sourceId='e2eordervendeur000000001';
DELETE FROM sale_lines WHERE saleId='e2eordervendeur000000001';
DELETE FROM sales WHERE id='e2eordervendeur000000001';
INSERT INTO sales (id, companyId, kind, status, channel, number, clientId, locationId, createdById, tourneeId, total, paid, date, createdAt, updatedAt)
SELECT 'e2eordervendeur000000001', u.companyId, 'ORDER', 'CONFIRMED', 'VAN', 'CMD-VENDEUR-1', c.id, 'e2evan200000000000000001', u.id, 'e2etourvendeur0000000001', 300, 0, '2026-10-11T10:00:00.000Z', datetime('now'), datetime('now')
FROM users u, customers c WHERE u.username='vendeur1' AND c.code='CLT-0001';
INSERT INTO sale_lines (id, saleId, productId, unitId, qty, baseQty, unitPrice, lineTotal)
SELECT 'e2eorderline00000000001', 'e2eordervendeur000000001', p.id, NULL, 2, 2, 150, 300
FROM products p WHERE p.reference='PRD-001';

-- DECLARED depot→van transfer for the receipt test (reset every run).
-- Goes to ghaith's van: the workflows spec syncs as ghaith (Livreur).
DELETE FROM transfer_lines WHERE transferId='e2etransfer00000000000001';
DELETE FROM transfers WHERE id='e2etransfer00000000000001';
INSERT INTO transfers (id, companyId, seasonId, number, fromLocationId, toLocationId, status, cashAmount, date, createdAt, updatedAt)
SELECT 'e2etransfer00000000000001', v.companyId, NULL, 'TRF-9000', d.id, v.id, 'DECLARED', 0, '2026-10-11T10:00:00.000Z', datetime('now'), datetime('now')
FROM stores v JOIN users u ON u.id=v.userId AND u.username='ghaith', stores d
WHERE v.kind='VAN' AND d.kind='DEPOT' AND d.companyId=v.companyId;
INSERT INTO transfer_lines (id, transferId, productId, declaredQty, confirmedQty)
SELECT 'e2etransferline00000001', 'e2etransfer00000000000001', p.id, 5, NULL
FROM products p WHERE p.reference='PRD-001';

-- Test-only relaxations + resets.
UPDATE company_settings SET qrStrictMode=0;
UPDATE customers SET name='زبون تجريبي — الأحد' WHERE code='CLT-0001';
SQL

# Reports fixture: dedicated van with FIXED numbers (total 200, profit 80,
# expenses 30, one 8h stamped day). Rerun-safe: wipes its own rows first.
sqlite3 -bail "$TEST" <<SQL
DELETE FROM sale_lines WHERE saleId='e2erepticket0000000001';
DELETE FROM sales WHERE id='e2erepticket0000000001';
DELETE FROM expenses WHERE id='e2erepexp000000000001';
DELETE FROM tournees WHERE id='e2ereptour00000000001';
DELETE FROM stores WHERE id='e2evanrep00000000000001';
INSERT INTO stores (id, companyId, name, kind, userId, isActive, createdAt, updatedAt)
SELECT 'e2evanrep00000000000001', id, 'Camion Rapport', 'VAN', NULL, 1, datetime('now'), datetime('now') FROM companies LIMIT 1;
INSERT INTO sales (id, companyId, kind, status, channel, number, clientId, locationId, total, paid, date, createdAt, updatedAt)
SELECT 'e2erepticket0000000001', c.id, 'TICKET', 'DELIVERED', 'VAN', 'REP-0001', c2.id, 'e2evanrep00000000000001', 200, 150, '2026-10-11T12:00:00.000Z', datetime('now'), datetime('now')
FROM companies c, customers c2 WHERE c2.code='CLT-0001' LIMIT 1;
INSERT INTO sale_lines (id, saleId, productId, unitId, qty, baseQty, unitPrice, lineTotal, unitCost)
SELECT 'e2erepline000000000001', 'e2erepticket0000000001', p.id, NULL, 2, 2, 100, 200, 60
FROM products p WHERE p.reference='PRD-001';
INSERT INTO expenses (id, companyId, locationId, label, amount, expenseDate, createdAt)
SELECT 'e2erepexp000000000001', c.id, 'e2evanrep00000000000001', 'Fuel test', 30, '2026-10-11T12:00:00.000Z', datetime('now') FROM companies c LIMIT 1;
INSERT INTO tournees (id, companyId, date, locationId, status, startedAt, finishedAt, createdAt)
SELECT 'e2ereptour00000000001', c.id, '2026-10-11T00:00:00.000Z', 'e2evanrep00000000000001', 'OPEN', '2026-10-11T07:00:00.000Z', '2026-10-11T15:00:00.000Z', datetime('now') FROM companies c LIMIT 1;
SQL

# Price tier Gros (reuse live one when present) + tier prices + 2nd product.
TIER="$(sqlite3 "$TEST" "SELECT id FROM price_tiers WHERE name='Gros' LIMIT 1;")"
if [[ -z "$TIER" ]]; then
  TIER="e2etiergros00000000000001"
  sqlite3 -bail "$TEST" "INSERT INTO price_tiers (id, companyId, name, sortOrder, isActive, createdAt) SELECT '$TIER', id, 'Gros', 1, 1, datetime('now') FROM companies LIMIT 1;"
fi
echo "tier Gros: $TIER"
sqlite3 -bail "$TEST" <<SQL
-- PRD-002 (second product for mixed-tier sales).
INSERT INTO products (id, companyId, name, reference, salePrice, costPrice, stockQty, isActive, createdAt, updatedAt)
SELECT 'e2eprd200000000000000001', id, 'منتج ثاني', 'PRD-002', 200, 140, 60, 1, datetime('now'), datetime('now') FROM companies
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id='e2eprd200000000000000001');
DELETE FROM stock_batches WHERE productId='e2eprd200000000000000001';
INSERT INTO stock_batches (id, companyId, productId, storeId, transferId, qty, initialQty, unitCost, createdAt)
SELECT 'e2ebatchdepot0000000002', id, 'e2eprd200000000000000001', (SELECT id FROM stores WHERE kind='DEPOT' LIMIT 1), NULL, 50, 50, 140, datetime('now') FROM companies LIMIT 1;
INSERT INTO stock_batches (id, companyId, productId, storeId, transferId, qty, initialQty, unitCost, createdAt)
SELECT 'e2ebatchvan000000000002', id, 'e2eprd200000000000000001', (SELECT id FROM stores WHERE kind='VAN' ORDER BY createdAt ASC LIMIT 1), NULL, 10, 10, 140, datetime('now') FROM companies LIMIT 1;
-- Tier prices (delete-then-insert: idempotent reruns).
DELETE FROM product_tier_prices WHERE tierId='$TIER';
INSERT INTO product_tier_prices (id, productId, tierId, price, updatedAt)
SELECT 'e2etp1gros00000000000001', p.id, '$TIER', 130, datetime('now') FROM products p WHERE p.reference='PRD-001';
INSERT INTO product_tier_prices (id, productId, tierId, price, updatedAt)
SELECT 'e2etp2gros000000000001', 'e2eprd200000000000000001', '$TIER', 170, datetime('now');
SQL

echo "fixture ok:"
sqlite3 "$TEST" "SELECT username,role FROM users WHERE username IN ('ghaith','vendeur1');"
sqlite3 "$TEST" "SELECT number,status FROM sales WHERE number='CMD-VENDEUR-1'; SELECT number,status FROM transfers WHERE number='TRF-9000';"
# Hard asserts: a silent skip here once cost hours of phantom failures.
[[ "$(sqlite3 "$TEST" "SELECT COUNT(*) FROM sync_ops;")" == "0" ]] || { echo "FATAL: sync_ops not empty" >&2; exit 1; }
[[ "$(sqlite3 "$TEST" "SELECT COUNT(*) FROM devices;")" == "0" ]] || { echo "FATAL: devices not empty" >&2; exit 1; }
[[ "$(sqlite3 "$TEST" "SELECT status FROM sales WHERE number='CMD-VENDEUR-1';")" == "CONFIRMED" ]] || { echo "FATAL: CMD-VENDEUR-1 not CONFIRMED" >&2; exit 1; }
[[ "$(sqlite3 "$TEST" "SELECT status FROM transfers WHERE number='TRF-9000';")" == "DECLARED" ]] || { echo "FATAL: TRF-9000 not DECLARED" >&2; exit 1; }
[[ "$(sqlite3 "$TEST" "SELECT COUNT(*) FROM product_tier_prices WHERE price IN (130,170);")" == "2" ]] || { echo "FATAL: tier prices missing" >&2; exit 1; }
[[ "$(sqlite3 "$TEST" "SELECT COUNT(*) FROM stock_batches WHERE productId='e2eprd200000000000000001';")" == "2" ]] || { echo "FATAL: PRD-002 batches missing" >&2; exit 1; }
echo "fixture verified clean"
