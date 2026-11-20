import { describe, expect, it } from "vitest";
import { checkOfflineSale, effectiveStock, pendingEffects, baseQtyOf } from "@/lib/sync/offline-rules";
import { snapshotColis, snapshotGifts } from "@/lib/threepack/offline";
import { colisOf } from "@/lib/threepack/match";
import type { VanSnapshot } from "@/lib/sync/client";
import type { OutboxRow } from "@/lib/sync/offline-db";

// The van phone derives gifts from the synced snapshot alone (no network),
// and refuses an over-claimed gift BEFORE goods change hands.

const RULE = {
  id: "r1", name: "10 → 1", mode: "SINGLE" as const, isActive: true,
  items: [{ role: "BUY" as const, productId: "p1", colis: 10 }, { role: "GIVE" as const, productId: "p1", colis: 1 }],
};

function snap(enabled = true): VanSnapshot {
  return {
    company: null,
    settings: { remiseEnabled: false, creditSalesEnabled: false, qrStrictMode: false, oversellAllowed: false, expiryEnabled: false, transferConfirmRequired: true, pieceSalesEnabled: false, debtTrackingEnabled: true, threePackEnabled: enabled },
    threePack: { enabled, rules: enabled ? [RULE] : [] },
    products: [
      { id: "p1", name: "A", reference: null, barcode: null, colisage: null, salePrice: 100, categoryId: null, images: [], baseUnit: { id: "u-pc", name: "pc" }, conversions: [{ unitId: "u-ctn", name: "ctn", factor: 12, barcode: null }], tierPrices: [] },
    ],
    units: [], tiers: [], categories: [], secteurs: [], wilayas: [],
    clients: [{ id: "c1", code: "CLT-1", name: "Client", phone: "0550000000", address: null, wilayaCode: null, tierId: null, balance: 0, creditLimit: 0 }],
    stock: [{ productId: "p1", qty: 1000 }],
  };
}
const bq = (s: VanSnapshot) => (pid: string, uid: string | null | undefined, q: number) => baseQtyOf(s, pid, uid, q);
// What a form passes: the rules + colis it computed the gift from.
const bonusFor = (s: VanSnapshot) => ({
  rules: s.threePack?.rules ?? [],
  colis: snapshotColis(s),
  baseQtyOf: (l: { productId: string; unitId?: string | null; qty: number }) => baseQtyOf(s, l.productId, l.unitId, l.qty),
});
const buy = (qty: number) => ({ productId: "p1", unitId: "u-ctn", qty, unitPrice: 1200, remise: 0 });
const gift = (qty: number) => ({ productId: "p1", unitId: "u-ctn", qty, unitPrice: 0, remise: 0, bonusRuleId: "r1" });
const op = (kind: string, payload: Record<string, unknown>): OutboxRow => ({ opId: `op-${kind}`, kind, payload, ts: Date.now(), attempts: 0, nextRetryAt: 0 });

describe("3pack offline (snapshot)", () => {
  it("colis comes from the snapshot's own conversions", () => {
    expect(snapshotColis(snap())["p1"]).toEqual({ unitId: "u-ctn", factor: 12 });
  });

  it("gift owed for the cart, with no network", () => {
    const s = snap();
    const g = snapshotGifts(s, [buy(25)], bq(s));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ ruleId: "r1", productId: "p1", unitId: "u-ctn", colis: 2, baseQty: 24 });
  });

  it("feature off in the snapshot → nothing", () => {
    const s = snap(false);
    expect(snapshotGifts(s, [buy(25)], bq(s))).toEqual([]);
  });

  it("an earned gift passes the offline check and counts in the stock cap", () => {
    const s = snap();
    const r = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines: [buy(10), gift(1)], paid: 12000, qrScanned: true, vanId: "van1", bonus: bonusFor(s) });
    expect(r.ok).toBe(true);
  });

  it("an over-claimed gift is refused locally with the SAME code the server returns", () => {
    const s = snap();
    const r = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines: [buy(10), gift(3)], paid: 12000, qrScanned: true, vanId: "van1", bonus: bonusFor(s) });
    expect(r).toEqual({ ok: false, error: "bonus_not_earned" });
  });

  it("the van must have the free colis on board when oversell is off (gift counts in the stock cap)", () => {
    const s = snap();
    s.stock = [{ productId: "p1", qty: 120 }]; // exactly the purchase, nothing left for the gift (12)
    const r = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines: [buy(10), gift(1)], paid: 12000, qrScanned: true, vanId: "van1", bonus: bonusFor(s) });
    expect(r).toEqual({ ok: false, error: "insufficient_stock" });
  });

  it("WITHOUT a bonus context (web session, no snapshot) a gift line is not cross-checked — never a false rejection", () => {
    const r = checkOfflineSale({ snap: null, ops: [], channel: "VAN", clientId: "c1", lines: [buy(10), gift(1)], paid: 12000, qrScanned: true, vanId: "van1" });
    expect(r.ok).toBe(true);
  });

  it("fresh rules newer than the snapshot validate against THEMSELVES, not the stale snapshot", () => {
    const s = snap();
    const fresh = { id: "r-new", name: "5 → 1", mode: "SINGLE" as const, isActive: true, items: [{ role: "BUY" as const, productId: "p1", colis: 5 }, { role: "GIVE" as const, productId: "p1", colis: 1 }] };
    const colis = snapshotColis(s);
    const lines = [buy(5), { productId: "p1", unitId: "u-ctn", qty: 1, unitPrice: 0, remise: 0, bonusRuleId: "r-new" }];
    const ok = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines, paid: 6000, qrScanned: true, vanId: "van1", bonus: { rules: [fresh], colis, baseQtyOf: bonusFor(s).baseQtyOf } });
    expect(ok.ok).toBe(true);
    // the snapshot's own (older, 10→1) rules would wrongly reject it:
    const stale = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines, paid: 6000, qrScanned: true, vanId: "van1", bonus: bonusFor(s) });
    expect(stale).toEqual({ ok: false, error: "bonus_not_earned" });
    void colisOf;
  });

  it("a queued ticket's gift lowers the van's effective stock", () => {
    const s = snap();
    const ticket = op("ticket", { clientId: "c1", paid: 12000, lines: [buy(10), gift(1)] });
    expect(pendingEffects(s, [ticket], "van1").stock["p1"]).toBe(-132);
    expect(effectiveStock(s, [ticket], "van1")["p1"]).toBe(1000 - 132);
  });
});
