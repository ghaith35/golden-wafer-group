import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// REAL end-to-end on the offline engine: the actual sales / 3pack services run
// against a real SQLite file (exactly what the desktop app does offline) —
// no mocks. Proves gifts persist, deduct stock, restore on cancel, reach the
// delivery/invoice, and that a van sale made offline under an OLD rule still
// syncs after the admin edited that rule.

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), "distribuili-3pack-e2e-"));
const dbFile = join(root, "e2e.db");

type Svc = typeof import("@/lib/sales/service");
type Tp = typeof import("@/lib/threepack/admin");
type Db = typeof import("@/lib/db");
let svc: Svc, tp: Tp, prisma: Db["prisma"];
const ids = { co: "", user: "", depot: "", van: "", client: "", pA: "", uBottle: "", uCarton: "" };

beforeAll(async () => {
  const Database = require("libsql");
  const ddl = readFileSync(resolve(__dirname, "../../prisma/sqlite-init.sql"), "utf8");
  const d = new Database(dbFile);
  d.exec(ddl);
  d.close();
  process.env.DISTRIBUILI_DB = "local";
  process.env.DISTRIBUILI_SQLITE_URL = `file:${dbFile}`;
  process.env.DISTRIBUILI_SQLITE_CLIENT = resolve(__dirname, "../../src/generated/prisma-sqlite");
  prisma = (await import("@/lib/db")).prisma;
  svc = await import("@/lib/sales/service");
  tp = await import("@/lib/threepack/admin");

  const co = await prisma.company.create({ data: { name: "E2E Co" } });
  ids.co = co.id;
  await prisma.companySettings.create({
    data: { companyId: co.id, threePackEnabled: true, oversellAllowed: false, qrStrictMode: false, creditSalesEnabled: true, pieceSalesEnabled: true },
  });
  ids.user = (await prisma.user.create({ data: { companyId: co.id, username: "admin", passwordHash: "x", fullName: "Admin", role: "Admin" } })).id;
  ids.depot = (await prisma.store.create({ data: { companyId: co.id, name: "Depot", kind: "DEPOT" } })).id;
  ids.van = (await prisma.store.create({ data: { companyId: co.id, name: "Van 1", kind: "VAN" } })).id;
  ids.client = (await prisma.customer.create({ data: { companyId: co.id, code: "CLT-1", name: "Client One" } })).id;
  ids.uBottle = (await prisma.unit.create({ data: { companyId: co.id, name: "Bottle" } })).id;
  ids.uCarton = (await prisma.unit.create({ data: { companyId: co.id, name: "Carton" } })).id;
  const p = await prisma.product.create({ data: { companyId: co.id, name: "Juice", salePrice: 100, baseUnitId: ids.uBottle, stockQty: 2000 } });
  ids.pA = p.id;
  await prisma.productUnitConversion.create({ data: { productId: p.id, unitId: ids.uCarton, factor: 12 } });
  // 1000 bottles in the depot, 1000 on the van.
  for (const storeId of [ids.depot, ids.van]) {
    await prisma.stockBatch.create({ data: { companyId: co.id, productId: p.id, storeId, qty: 1000, initialQty: 1000, unitCost: 60 } });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

const stockAt = async (storeId: string) =>
  Number((await prisma.stockBatch.aggregate({ where: { productId: ids.pA, storeId, transferId: null }, _sum: { qty: true } }))._sum.qty ?? 0);
const carton = (qty: number, extra: Record<string, unknown> = {}) => ({ productId: ids.pA, unitId: ids.uCarton, qty, ...extra });

describe("3pack on the offline (SQLite) engine — real services, no mocks", () => {
  let ruleId = "";

  it("admin creates a Single rule (10 → 1) and it is listed", async () => {
    const rule = await prisma.threePackRule.create({
      data: {
        companyId: ids.co, name: "10 → 1", mode: "SINGLE",
        items: { create: [{ role: "BUY", productId: ids.pA, colis: 10 }, { role: "GIVE", productId: ids.pA, colis: 1 }] },
      },
    });
    ruleId = rule.id;
    const list = await tp.listRulesForAdmin(ids.co);
    expect(list).toHaveLength(1);
    expect(list[0].items.map((i) => [i.role, i.colis])).toEqual(expect.arrayContaining([["BUY", 10], ["GIVE", 1]]));
  });

  it("order → gift line persisted at price 0; confirm → deliver deducts purchase + gift; cancel restores it all", async () => {
    const order = await svc.createOrder(ids.co, { clientId: ids.client, lines: [carton(25)] } as never);
    const lines = order.lines;
    expect(lines).toHaveLength(2);
    const gift = lines.find((l) => l.isBonus)!;
    expect(Number(gift.qty)).toBe(2); // 25 colis → 2 free (every multiple)
    expect(Number(gift.baseQty)).toBe(24);
    expect(Number(gift.unitPrice)).toBe(0);
    expect(Number(gift.lineTotal)).toBe(0);
    expect(gift.bonusRuleId).toBe(ruleId);
    expect(Number(order.total)).toBe(25 * 1200); // gift adds nothing to the bill

    await svc.confirmOrder(ids.co, order.id);
    const before = await stockAt(ids.depot);
    const delivery = await svc.deliverOrder(ids.co, order.id, ids.depot, 25 * 1200);
    expect(delivery.lines.filter((l) => l.isBonus)).toHaveLength(1); // gift reaches the delivery note
    expect(before - (await stockAt(ids.depot))).toBe(300 + 24); // 25 colis + 2 free colis, in bottles

    const mid = await stockAt(ids.depot);
    await svc.cancelSale(ids.co, delivery.id);
    expect((await stockAt(ids.depot)) - mid).toBe(324); // stock restored, gift included
  });

  it("the gift reaches the INVOICE too", async () => {
    const order = await svc.createOrder(ids.co, { clientId: ids.client, lines: [carton(10)] } as never);
    await svc.confirmOrder(ids.co, order.id);
    const delivery = await svc.deliverOrder(ids.co, order.id, ids.depot, 12000);
    const invoice = await svc.createInvoice(ids.co, delivery.id);
    expect(invoice.lines.filter((l) => l.isBonus).map((l) => Number(l.qty))).toEqual([1]);
    expect(invoice.lines.filter((l) => !l.isBonus).map((l) => Number(l.lineTotal))).toEqual([12000]);
  });

  it("a forged gift on an online ticket is ignored; the server's own gift is applied", async () => {
    const forged = carton(40, { unitPrice: 0, bonusRuleId: ruleId });
    const sale = await svc.createTicket(ids.co, ids.user, { locationId: ids.van, channel: "VAN", qrScanned: true, clientId: ids.client, lines: [carton(9), forged] } as never);
    expect(sale.lines.filter((l) => l.isBonus)).toHaveLength(0); // 9 colis earn nothing, forged line dropped
    expect(sale.lines).toHaveLength(1);
  });

  it("OFFLINE: van sells under the old rule, admin edits the rule, phone syncs later → still accepted; over-claim rejected", async () => {
    // 1. The phone (offline) sold 10 colis and handed over 1 free colis under rule `ruleId`.
    // 2. Before it syncs, the admin raises the threshold to 20.
    const r = await tp.replaceRule(ids.co, ruleId, {
      name: "20 → 1", mode: "SINGLE",
      items: [{ role: "BUY", productId: ids.pA, colis: 20 }, { role: "GIVE", productId: ids.pA, colis: 1 }],
    });
    expect(r.versioned).toBe(true);
    expect(r.id).not.toBe(ruleId);
    const listed = await tp.listRulesForAdmin(ids.co);
    expect(listed.map((x) => x.id)).toEqual([r.id]); // archived version hidden from the admin list

    const vanBefore = await stockAt(ids.van);
    const synced = await svc.createTicket(
      ids.co, ids.user,
      { locationId: ids.van, channel: "VAN", qrScanned: true, clientId: ids.client, paid: 12000, lines: [carton(10, { unitPrice: 1200 }), carton(1, { unitPrice: 0, bonusRuleId: ruleId })] } as never,
      { opId: "offline-op-1" },
    );
    expect(synced.lines.filter((l) => l.isBonus)).toHaveLength(1);
    expect(Number(synced.total)).toBe(12000);
    expect(vanBefore - (await stockAt(ids.van))).toBe(132); // purchase + gift left the van

    // an over-claim under the same old rule is refused (10 colis earn exactly 1)
    await expect(
      svc.createTicket(
        ids.co, ids.user,
        { locationId: ids.van, channel: "VAN", qrScanned: true, clientId: ids.client, paid: 12000, lines: [carton(10, { unitPrice: 1200 }), carton(5, { unitPrice: 0, bonusRuleId: ruleId })] } as never,
        { opId: "offline-op-2" },
      ),
    ).rejects.toThrow("bonus_not_earned");
    // …and nothing was written for the rejected op
    expect(await prisma.sale.count({ where: { opId: "offline-op-2" } })).toBe(0);
  });

  it("one offline op leaves exactly one sale with exactly one gift line", async () => {
    expect(await prisma.sale.count({ where: { opId: "offline-op-1" } })).toBe(1);
    expect(await prisma.saleLine.count({ where: { sale: { opId: "offline-op-1" }, isBonus: true } })).toBe(1);
  });
});

// ── The van PHONE round trip: pull snapshot → go offline → sell → sync ─────────
describe("3pack — van phone round trip (real sync engine, real SQLite)", () => {
  const TOKEN = "phone-token-0123456789abcdef";
  type Pulled = import("@/lib/sync/client").VanSnapshot;
  let engine: typeof import("@/lib/sync/engine");
  let offline: typeof import("@/lib/threepack/offline");
  let rules: typeof import("@/lib/sync/offline-rules");
  let livreurId = "";

  beforeAll(async () => {
    engine = await import("@/lib/sync/engine");
    offline = await import("@/lib/threepack/offline");
    rules = await import("@/lib/sync/offline-rules");
    livreurId = (await prisma.user.create({ data: { companyId: ids.co, username: "livreur", passwordHash: "x", fullName: "Livreur", role: "Livreur" } })).id;
    await prisma.device.create({
      data: { companyId: ids.co, label: "Phone", locationId: ids.van, userId: livreurId, tokenHash: createHash("sha256").update(TOKEN).digest("hex") },
    });
  });

  // What the phone stores in IndexedDB: the pulled JSON, serialised.
  const pull = async (): Promise<Pulled> => {
    const r = await engine.handleSync({ deviceToken: TOKEN, ops: [] } as never);
    return JSON.parse(JSON.stringify(r.pulled)) as Pulled;
  };
  const oneRule = async () => (await prisma.threePackRule.findMany({ where: { companyId: ids.co, isActive: true } }))[0];

  it("the snapshot carries the 3pack switch, the ACTIVE rules, and the colis units", async () => {
    const snap = await pull();
    expect(snap.threePack?.enabled).toBe(true);
    expect(snap.settings.threePackEnabled).toBe(true);
    expect(snap.threePack?.rules).toHaveLength(1); // archived versions are not sent
    expect(snap.threePack?.rules[0].items.map((i) => [i.role, i.colis])).toEqual(expect.arrayContaining([["BUY", 20], ["GIVE", 1]]));
    expect(offline.snapshotColis(snap)[ids.pA]).toEqual({ unitId: ids.uCarton, factor: 12 });
  });

  it("offline: gift computed from the stored snapshot alone, ticket queued, synced → gift line + stock deducted", async () => {
    const snap = await pull(); // phone goes offline holding this snapshot
    const r = (await oneRule())!;
    const bq = (pid: string, uid: string | null | undefined, q: number) => rules.baseQtyOf(snap, pid, uid, q);

    // vendeur/livreur enters 40 colis; the phone adds the gift with NO network
    const bought = [{ productId: ids.pA, unitId: ids.uCarton, qty: 40, unitPrice: 1200, remise: 0 }];
    const gifts = offline.snapshotGifts(snap, bought, bq);
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ ruleId: r.id, colis: 2, baseQty: 24 });
    const giftLines = gifts.map((g) => ({ productId: g.productId, unitId: g.unitId, qty: g.colis, unitPrice: 0, remise: 0, bonusRuleId: g.ruleId }));

    // the phone's own pre-save guard accepts it and counts the gift in effective stock
    const check = rules.checkOfflineSale({
      snap, ops: [], channel: "VAN", clientId: ids.client, lines: [...bought, ...giftLines], paid: 48000, qrScanned: true, vanId: ids.van,
      bonus: { rules: snap.threePack!.rules, colis: offline.snapshotColis(snap), baseQtyOf: (l) => bq(l.productId, l.unitId, l.qty) },
    });
    expect(check.ok).toBe(true);

    // …then back online: push the queued op through the real sync engine
    const before = await stockAt(ids.van);
    const res = await engine.handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "phone-op-aaaa1111", kind: "ticket", occurredAt: Date.now() - 3_600_000, payload: { clientId: ids.client, locationId: ids.van, channel: "VAN", qrScanned: true, paid: 48000, lines: [...bought, ...giftLines] } }],
    } as never);
    expect(res.applied[0]).toMatchObject({ ok: true });
    const sale = await prisma.sale.findFirst({ where: { opId: "phone-op-aaaa1111" }, include: { lines: true } });
    expect(sale!.lines.filter((l) => l.isBonus).map((l) => Number(l.qty))).toEqual([2]);
    expect(Number(sale!.total)).toBe(48000);
    expect(before - (await stockAt(ids.van))).toBe(480 + 24);

    // a retry of the same queued op (flaky network) is idempotent
    const again = await engine.handleSync({ deviceToken: TOKEN, ops: [{ opId: "phone-op-aaaa1111", kind: "ticket", payload: {} }] } as never);
    expect(again.applied[0]).toMatchObject({ ok: true });
    expect(await prisma.sale.count({ where: { opId: "phone-op-aaaa1111" } })).toBe(1);
    expect(before - (await stockAt(ids.van))).toBe(480 + 24);
  });

  it("offline sale under rule R2, admin edits to R3 before the phone syncs → STILL accepted", async () => {
    const snap = await pull();
    const r2 = (await oneRule())!;
    const bq = (pid: string, uid: string | null | undefined, q: number) => rules.baseQtyOf(snap, pid, uid, q);
    const bought = [{ productId: ids.pA, unitId: ids.uCarton, qty: 20, unitPrice: 1200, remise: 0 }];
    const g = offline.snapshotGifts(snap, bought, bq);
    const giftLines = g.map((x) => ({ productId: x.productId, unitId: x.unitId, qty: x.colis, unitPrice: 0, remise: 0, bonusRuleId: x.ruleId }));
    expect(giftLines).toHaveLength(1);

    // admin raises the threshold again while the phone is still offline
    const r3 = await tp.replaceRule(ids.co, r2.id, { name: "30 → 1", mode: "SINGLE", items: [{ role: "BUY", productId: ids.pA, colis: 30 }, { role: "GIVE", productId: ids.pA, colis: 1 }] });
    expect(r3.versioned).toBe(true);

    const res = await engine.handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "phone-op-bbbb2222", kind: "ticket", payload: { clientId: ids.client, locationId: ids.van, channel: "VAN", qrScanned: true, paid: 24000, lines: [...bought, ...giftLines] } }],
    } as never);
    expect(res.applied[0]).toMatchObject({ ok: true });
    expect(await prisma.saleLine.count({ where: { sale: { opId: "phone-op-bbbb2222" }, isBonus: true } })).toBe(1);
  });

  it("a tampered / over-claimed offline gift is rejected as a PERMANENT failure with a clear code", async () => {
    const r3 = (await oneRule())!;
    const res = await engine.handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "phone-op-cccc3333", kind: "ticket", payload: { clientId: ids.client, locationId: ids.van, channel: "VAN", qrScanned: true, paid: 1200, lines: [{ productId: ids.pA, unitId: ids.uCarton, qty: 1, unitPrice: 1200 }, { productId: ids.pA, unitId: ids.uCarton, qty: 50, unitPrice: 0, bonusRuleId: r3.id }] } }],
    } as never);
    expect(res.applied[0]).toMatchObject({ ok: false, error: "bonus_not_earned", permanent: true });
    expect(await prisma.sale.count({ where: { opId: "phone-op-cccc3333" } })).toBe(0);
  });

  it("an OFFLINE ORDER (vendeur) with a gift syncs as a DRAFT order carrying the gift line", async () => {
    const snap = await pull();
    const r = (await oneRule())!; // R3: 30 → 1
    const bq = (pid: string, uid: string | null | undefined, q: number) => rules.baseQtyOf(snap, pid, uid, q);
    const bought = [{ productId: ids.pA, unitId: ids.uCarton, qty: 30 }];
    const gifts = offline.snapshotGifts(snap, bought, bq);
    expect(gifts[0]).toMatchObject({ ruleId: r.id, colis: 1 });
    const res = await engine.handleSync({
      deviceToken: TOKEN,
      ops: [{ opId: "phone-op-dddd4444", kind: "order", payload: { clientId: ids.client, locationId: ids.van, channel: "VAN", lines: [...bought, ...gifts.map((x) => ({ productId: x.productId, unitId: x.unitId, qty: x.colis, bonusRuleId: x.ruleId }))] } }],
    } as never);
    expect(res.applied[0]).toMatchObject({ ok: true });
    const order = await prisma.sale.findFirst({ where: { opId: "phone-op-dddd4444" }, include: { lines: true } });
    expect(order!.kind).toBe("ORDER");
    expect(order!.status).toBe("DRAFT");
    expect(order!.lines.filter((l) => l.isBonus)).toHaveLength(1);
    expect(Number(order!.total)).toBe(30 * 1200);
  });
});

describe("3pack — the free product can be ANY product (not only the one bought)", () => {
  it("buy 10 colis of Juice → 2 colis of Water free: gift is Water, stock leaves Water (not Juice)", async () => {
    const water = await prisma.product.create({ data: { companyId: ids.co, name: "Water", salePrice: 50, baseUnitId: ids.uBottle, stockQty: 600 } });
    await prisma.productUnitConversion.create({ data: { productId: water.id, unitId: ids.uCarton, factor: 6 } });
    await prisma.stockBatch.create({ data: { companyId: ids.co, productId: water.id, storeId: ids.depot, qty: 600, initialQty: 600, unitCost: 20 } });
    // one active rule only for this scenario: deactivate whatever earlier tests left
    await prisma.threePackRule.updateMany({ where: { companyId: ids.co }, data: { isActive: false } });
    await prisma.threePackRule.create({
      data: {
        companyId: ids.co, name: "Juice → Water", mode: "SINGLE",
        items: { create: [{ role: "BUY", productId: ids.pA, colis: 10 }, { role: "GIVE", productId: water.id, colis: 2 }] },
      },
    });

    const order = await svc.createOrder(ids.co, { clientId: ids.client, lines: [carton(10)] } as never);
    const gift = order.lines.find((l) => l.isBonus)!;
    expect(gift.productId).toBe(water.id);
    expect(Number(gift.qty)).toBe(2);
    expect(Number(gift.baseQty)).toBe(12); // 2 cartons × 6 bottles
    expect(Number(order.total)).toBe(12000);

    await svc.confirmOrder(ids.co, order.id);
    const juiceBefore = await stockAt(ids.depot);
    const waterBefore = Number((await prisma.stockBatch.aggregate({ where: { productId: water.id, storeId: ids.depot }, _sum: { qty: true } }))._sum.qty);
    await svc.deliverOrder(ids.co, order.id, ids.depot, 12000);
    const waterAfter = Number((await prisma.stockBatch.aggregate({ where: { productId: water.id, storeId: ids.depot }, _sum: { qty: true } }))._sum.qty);
    expect(juiceBefore - (await stockAt(ids.depot))).toBe(120); // only the purchase leaves Juice
    expect(waterBefore - waterAfter).toBe(12); // the gift leaves Water
  });
});
