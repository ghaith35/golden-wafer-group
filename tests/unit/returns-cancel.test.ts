import { beforeEach, describe, expect, it, vi } from "vitest";

// Reverse flows: client returns restock the van, cancellations reverse stock
// + debt exactly once, confirming promises stock the PC must actually have.
// A synced phone return/cancel must never double-restock or leave debt behind.

vi.mock("@/lib/db", () => ({
  prisma: {
    sale: { findFirst: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn() },
    customer: { findFirst: vi.fn() },
    store: { findFirst: vi.fn() },
    product: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/settings/helpers", () => ({ getOrCreateSettings: vi.fn() }));
vi.mock("@/lib/docs/sequences", () => ({
  nextDocNumber: vi.fn(async () => "RC-2026-0001"),
  ensureSeasonFor: vi.fn(async () => ({ id: "season1" })),
}));
vi.mock("@/lib/inventory/stock", () => ({
  consumeStock: vi.fn(),
  addStock: vi.fn(async () => ({})),
  weightedCost: vi.fn(() => 0),
  locationQty: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { addStock } from "@/lib/inventory/stock";
import { cancelSale, confirmOrder, createClientReturn, reopenOrder } from "@/lib/sales/service";

beforeEach(() => {
  vi.clearAllMocks();
  (getOrCreateSettings as any).mockResolvedValue({ debtTrackingEnabled: true });
});

function txCapture() {
  const calls = { addStock: [] as any[], custUpdates: [] as any[], prodUpdates: [] as any[], saleUpdates: [] as any[], created: [] as any[] };
  const tx = {
    clientReturn: {
      create: vi.fn(async (a: any) => { calls.created.push(a.data); return { id: "ret1", ...a.data }; }),
      findUniqueOrThrow: vi.fn(async () => ({ id: "ret1" })),
    },
    clientReturnLine: { create: vi.fn(async (a: any) => a.data) },
    product: { update: vi.fn(async (a: any) => { calls.prodUpdates.push(a); return {}; }) },
    customer: { update: vi.fn(async (a: any) => { calls.custUpdates.push(a); return {}; }) },
    sale: { update: vi.fn(async (a: any) => { calls.saleUpdates.push(a); return {}; }) },
  };
  (prisma.$transaction as any).mockImplementation(async (cb: any) => {
    const out = await cb(tx);
    (out as any)._tx = tx;
    (out as any)._calls = calls;
    return out;
  });
  return calls;
}

describe("createClientReturn — synced phone return", () => {
  beforeEach(() => {
    (prisma.customer.findFirst as any).mockResolvedValue({ id: "c1" });
    (prisma.store.findFirst as any).mockResolvedValue({ id: "van1" });
    (prisma.product.findMany as any).mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
  });

  const retInput = (over: Record<string, unknown> = {}) => ({
    clientId: "c1",
    locationId: "van1",
    refundType: "DEBT_CREDIT",
    lines: [
      { productId: "p1", baseQty: 2, unitPrice: 100 },
      { productId: "p2", baseQty: 1, unitPrice: 50 },
    ],
    ...over,
  });

  it("CRITICAL: restocks every line at return price + increments global stock", async () => {
    const calls = txCapture();
    await createClientReturn("co", retInput() as any);
    expect((addStock as any).mock.calls.map((c: any[]) => [c[1].productId, c[1].qty, c[1].unitCost])).toEqual([
      ["p1", 2, 100],
      ["p2", 1, 50],
    ]);
    expect(calls.prodUpdates).toMatchObject([{ where: { id: "p1" } }, { where: { id: "p2" } }]);
  });

  it("CRITICAL: DEBT_CREDIT total 250 decrements client debt once (2×100 + 1×50)", async () => {
    const calls = txCapture();
    await createClientReturn("co", retInput() as any);
    expect(calls.custUpdates).toHaveLength(1);
    expect(calls.custUpdates[0]).toMatchObject({ where: { id: "c1" }, data: { balance: { decrement: 250 } } });
  });

  it("CASH refund restocks but never touches the debt ledger", async () => {
    const calls = txCapture();
    await createClientReturn("co", retInput({ refundType: "CASH" }) as any);
    expect((addStock as any)).toHaveBeenCalledTimes(2);
    expect(calls.custUpdates).toHaveLength(0);
  });

  it("bad client/location → bad_ref, unknown product → bad_product (sync FAILED, nothing half-written)", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    await expect(createClientReturn("co", retInput() as any)).rejects.toThrow("bad_ref");
    (prisma.customer.findFirst as any).mockResolvedValue({ id: "c1" });
    (prisma.product.findMany as any).mockResolvedValue([{ id: "p1" }]);
    await expect(createClientReturn("co", retInput() as any)).rejects.toThrow("bad_product");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("cancelSale — undo a synced ticket/delivery", () => {
  it("unknown sale → not_found, already cancelled → bad_status", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue(null);
    await expect(cancelSale("co", "ghost")).rejects.toThrow("not_found");
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "s", status: "CANCELLED" });
    await expect(cancelSale("co", "s")).rejects.toThrow("bad_status");
  });

  it("DRAFT order cancel: no stock, no debt — just CANCELLED", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "o1", kind: "ORDER", status: "DRAFT", lines: [], total: 500, paid: 0, clientId: "c1", locationId: null });
    const calls = txCapture();
    await cancelSale("co", "o1");
    expect((addStock as any)).not.toHaveBeenCalled();
    expect(calls.custUpdates).toHaveLength(0);
    expect(calls.saleUpdates[0]).toMatchObject({ where: { id: "o1" }, data: { status: "CANCELLED" } });
  });

  it("CRITICAL: DELIVERED ticket cancel restocks at recorded cost + reverses debt once", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue({
      id: "t1", kind: "TICKET", status: "DELIVERED", locationId: "van1",
      total: 300, paid: 100, clientId: "c1",
      lines: [{ productId: "p1", baseQty: 4, unitCost: 60 }],
    });
    const calls = txCapture();
    await cancelSale("co", "t1");
    expect((addStock as any).mock.calls[0][1]).toMatchObject({ locationId: "van1", productId: "p1", qty: 4, unitCost: 60 });
    expect(calls.custUpdates[0]).toMatchObject({ where: { id: "c1" }, data: { balance: { decrement: 200 } } });
  });

  it("fully-paid ticket cancel restocks but leaves debt alone (due 0)", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue({
      id: "t2", kind: "TICKET", status: "DELIVERED", locationId: "van1",
      total: 300, paid: 300, clientId: "c1", lines: [{ productId: "p1", baseQty: 1, unitCost: 60 }],
    });
    const calls = txCapture();
    await cancelSale("co", "t2");
    expect((addStock as any)).toHaveBeenCalledTimes(1);
    expect(calls.custUpdates).toHaveLength(0);
  });

  it("debt tracking OFF: cancel restocks, debt untouched", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ debtTrackingEnabled: false });
    (prisma.sale.findFirst as any).mockResolvedValue({
      id: "t3", kind: "DELIVERY", status: "DELIVERED", locationId: "d1",
      total: 300, paid: 0, clientId: "c1", lines: [{ productId: "p1", baseQty: 1, unitCost: 60 }],
    });
    const calls = txCapture();
    await cancelSale("co", "t3");
    expect((addStock as any)).toHaveBeenCalledTimes(1);
    expect(calls.custUpdates).toHaveLength(0);
  });
});

describe("confirmOrder — promise only what the depot has", () => {
  const orderWith = (lines: Array<{ productId: string; baseQty: number; name?: string }>) => ({
    id: "o1", kind: "ORDER", status: "DRAFT",
    lines: lines.map((l, i) => ({ id: `l${i}`, productId: l.productId, baseQty: String(l.baseQty), product: { id: l.productId, name: l.name ?? l.productId, stockQty: "0" } })),
  });

  it("sufficient global stock → CONFIRMED", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue(orderWith([{ productId: "p1", baseQty: 5 }]));
    (prisma.product.findFirst as any).mockResolvedValue({ stockQty: "10" });
    (prisma.sale.update as any).mockResolvedValue({});
    await confirmOrder("co", "o1");
    expect(prisma.sale.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CONFIRMED" } }));
  });

  it("CRITICAL: short stock throws insufficient_stock with need/have detail (PC shows it, phone FAILED)", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue(orderWith([{ productId: "p1", baseQty: 8, name: "Huile" }]));
    (prisma.product.findFirst as any).mockResolvedValue({ stockQty: "3" });
    const err = await confirmOrder("co", "o1").catch((e) => e);
    expect(err.message).toBe("insufficient_stock");
    expect(err.short).toEqual([{ productId: "p1", name: "Huile", need: 8, have: 3 }]);
    expect(prisma.sale.update).not.toHaveBeenCalled();
  });

  it("same product on two lines sums the need (3+4=7 > 5 → short)", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue(
      orderWith([{ productId: "p1", baseQty: 3 }, { productId: "p1", baseQty: 4 }])
    );
    (prisma.product.findFirst as any).mockResolvedValue({ stockQty: "5" });
    const err = await confirmOrder("co", "o1").catch((e) => e);
    expect(err.message).toBe("insufficient_stock");
    expect(err.short[0]).toMatchObject({ productId: "p1", need: 7, have: 5 });
  });

  it("wrong status (already CONFIRMED) → bad_status, no re-confirm", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "o1", kind: "ORDER", status: "CONFIRMED", lines: [] });
    await expect(confirmOrder("co", "o1")).rejects.toThrow("bad_status");
  });
});

describe("reopenOrder — livreur redoes a delivery", () => {
  it("reverses child delivery stock + debt, child CANCELLED, order back to CONFIRMED", async () => {
    (prisma.sale.findFirst as any).mockResolvedValue({ id: "o1", kind: "ORDER", status: "DELIVERED", lines: [] });
    (prisma.sale.findMany as any).mockResolvedValue([
      { id: "d1", kind: "DELIVERY", status: "DELIVERED", locationId: "van1", total: 200, paid: 50, clientId: "c1", lines: [{ productId: "p1", baseQty: 2, unitCost: 60 }] },
    ]);
    const saleUpdates: any[] = [];
    const custUpdates: any[] = [];
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        product: { update: async () => ({}) },
        customer: { update: vi.fn(async (a: any) => { custUpdates.push(a); return {}; }) },
        sale: { update: vi.fn(async (a: any) => { saleUpdates.push(a); return {}; }) },
      })
    );
    await reopenOrder("co", "o1");
    expect((addStock as any).mock.calls[0][1]).toMatchObject({ productId: "p1", qty: 2, unitCost: 60 });
    expect(custUpdates[0]).toMatchObject({ where: { id: "c1" }, data: { balance: { decrement: 150 } } });
    expect(saleUpdates).toMatchObject([
      { where: { id: "d1" }, data: { status: "CANCELLED" } },
      { where: { id: "o1" }, data: { status: "CONFIRMED" } },
    ]);
  });
});
