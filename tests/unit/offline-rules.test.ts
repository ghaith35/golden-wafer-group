import { describe, expect, it } from "vitest";
import { checkOfflineClient, checkOfflineSale, effectiveStock, pendingEffects } from "@/lib/sync/offline-rules";
import type { VanSnapshot } from "@/lib/sync/client";
import type { OutboxRow } from "@/lib/sync/offline-db";

const settings = {
  remiseEnabled: false,
  creditSalesEnabled: false,
  qrStrictMode: true,
  oversellAllowed: true,
  expiryEnabled: false,
  transferConfirmRequired: true,
  pieceSalesEnabled: false,
  debtTrackingEnabled: true,
};

function snap(over: Partial<VanSnapshot> = {}): VanSnapshot {
  return {
    company: null,
    settings,
    products: [
      { id: "p1", name: "A", reference: null, barcode: null, colisage: null, salePrice: 100, categoryId: null, images: [], baseUnit: { id: "u1", name: "pc" }, conversions: [{ unitId: "u2", name: "ctn", factor: 12, barcode: null }], tierPrices: [] },
    ],
    units: [],
    tiers: [],
    categories: [],
    secteurs: [],
    wilayas: [],
    clients: [
      { id: "c1", code: "CLT-1", name: "Client", phone: "0550000000", address: null, wilayaCode: null, tierId: null, balance: 0, creditLimit: 0 },
    ],
    stock: [{ productId: "p1", qty: 10 }],
    ...over,
  };
}

function op(kind: string, payload: Record<string, unknown>): OutboxRow {
  return { opId: `op-${kind}`, kind, payload, ts: Date.now(), attempts: 0, nextRetryAt: 0 };
}

describe("offline-rules — pending effects", () => {
  it("a queued ticket removes stock and adds credit debt", () => {
    const ops = [op("ticket", { clientId: "c1", paid: 0, lines: [{ productId: "p1", unitId: null, qty: 5, unitPrice: 100, remise: 0 }] })];
    const eff = pendingEffects(snap(), ops);
    expect(eff.stock.p1).toBe(-5);
    expect(eff.balance.c1).toBe(500);
    expect(effectiveStock(snap(), ops).p1).toBe(5);
  });

  it("a queued payment reduces the debt", () => {
    const ops = [op("versement", { clientId: "c1", amount: 200 })];
    expect(pendingEffects(snap(), ops).balance.c1).toBe(-200);
  });
});

describe("offline-rules — sale guard", () => {
  const line = { productId: "p1", unitId: null, qty: 1, unitPrice: 100, remise: 0 };

  it("cash_only when credit is disabled and the sale leaves a debt", () => {
    const r = checkOfflineSale({ snap: snap(), ops: [], channel: "VAN", clientId: "c1", lines: [line], paid: 0, qrScanned: true });
    expect(r).toMatchObject({ ok: false, error: "cash_only" });
  });

  it("ok when fully paid", () => {
    const r = checkOfflineSale({ snap: snap(), ops: [], channel: "VAN", clientId: "c1", lines: [line], paid: 100, qrScanned: true });
    expect(r.ok).toBe(true);
  });

  it("qr_required in strict mode on a van sale without a scan", () => {
    const s = snap({ settings: { ...settings, creditSalesEnabled: true } });
    const r = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines: [line], paid: 100, qrScanned: false });
    expect(r).toMatchObject({ ok: false, error: "qr_required" });
  });

  it("insufficient_stock when oversell is off and pending sales ate the stock", () => {
    const s = snap({ settings: { ...settings, oversellAllowed: false, creditSalesEnabled: true }, stock: [{ productId: "p1", qty: 3 }] });
    const r = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines: [{ ...line, qty: 5 }], paid: 500, qrScanned: true });
    expect(r).toMatchObject({ ok: false, error: "insufficient_stock" });
  });

  it("credit_limit_exceeded uses the effective (pending) balance", () => {
    const s = snap({
      settings: { ...settings, creditSalesEnabled: true },
      clients: [{ id: "c1", code: "CLT-1", name: "Client", phone: "0550000000", address: null, wilayaCode: null, tierId: null, balance: 0, creditLimit: 400 }],
    });
    const r = checkOfflineSale({ snap: s, ops: [], channel: "VAN", clientId: "c1", lines: [{ ...line, qty: 5 }], paid: 0, qrScanned: true });
    expect(r).toMatchObject({ ok: false, error: "credit_limit_exceeded" });
  });
});

describe("offline-rules — client guard", () => {
  it("rejects a malformed phone", () => {
    expect(checkOfflineClient(snap(), [], { phone: "0550" })).toMatchObject({ ok: false, error: "bad_phone" });
  });
  it("rejects a duplicate phone already in the snapshot", () => {
    expect(checkOfflineClient(snap(), [], { phone: "0550000000" })).toMatchObject({ ok: false, error: "duplicate_phone" });
  });
  it("accepts a valid new phone", () => {
    expect(checkOfflineClient(snap(), [], { phone: "0661112233" }).ok).toBe(true);
  });
});
