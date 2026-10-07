import { beforeEach, describe, expect, it, vi } from "vitest";

// Transfer + till: stock must leave the source at declare, arrive only at
// confirm; till math dueCash = collected + payments − expenses − cash returns.

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    store: { findMany: vi.fn(), findFirst: vi.fn() },
    product: { findMany: vi.fn() },
    productUnitConversion: { findMany: vi.fn(async () => []) },
    sale: { findMany: vi.fn(async () => []) },
    versement: { findMany: vi.fn(async () => []), create: vi.fn() },
    expense: { findMany: vi.fn(async () => []) },
    clientReturn: { findMany: vi.fn(async () => []) },
    dailyClose: { findFirst: vi.fn(async () => null), upsert: vi.fn() },
    transfer: { findMany: vi.fn(async () => []) },
    tournee: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/settings/helpers", () => ({ getOrCreateSettings: vi.fn() }));
vi.mock("@/lib/docs/sequences", () => ({
  nextDocNumber: vi.fn(async () => "TRF-2026-0001"),
  ensureSeasonFor: vi.fn(async () => ({ id: "season1" })),
}));
vi.mock("@/lib/inventory/stock", () => ({
  consumeStock: vi.fn(),
  addStock: vi.fn(),
  weightedCost: vi.fn(() => 80),
  locationQty: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { declareTransfer } from "@/lib/inventory/service";
import { closeDay, declareCash, remitCash, vanDayCash } from "@/lib/cash/daily";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("declareTransfer guards (offline transfer-declare op)", () => {
  it("same source and destination → same_location", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ vanBindingMode: "LOCKED", multiDepotEnabled: true, pieceSalesEnabled: true, expiryEnabled: false });
    await expect(declareTransfer("co", "u1", { fromLocationId: "v1", toLocationId: "v1", lines: [] } as any)).rejects.toThrow("same_location");
  });

  it("depot→depot without multiDepotEnabled → multidepot_disabled", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ vanBindingMode: "LOCKED", multiDepotEnabled: false, pieceSalesEnabled: true, expiryEnabled: false });
    (prisma.store.findMany as any).mockResolvedValue([{ id: "d1", kind: "DEPOT" }, { id: "d2", kind: "DEPOT" }]);
    (prisma.user.findFirst as any).mockResolvedValue({ id: "u1", role: "Admin", assignedVans: [] });
    await expect(
      declareTransfer("co", "u1", { fromLocationId: "d1", toLocationId: "d2", lines: [{ productId: "p", qty: 1 }] } as any)
    ).rejects.toThrow("multidepot_disabled");
  });

  it("pack-only rule: loose qty of packed product → pack_only_qty", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ vanBindingMode: "LOCKED", multiDepotEnabled: true, pieceSalesEnabled: false, expiryEnabled: false });
    (prisma.store.findMany as any).mockResolvedValue([{ id: "d1", kind: "DEPOT" }, { id: "v1", kind: "VAN" }]);
    (prisma.user.findFirst as any).mockResolvedValue({ id: "u1", role: "Admin", assignedVans: [] });
    (prisma.product.findMany as any).mockResolvedValue([{ id: "p1" }]);
    (prisma.productUnitConversion.findMany as any).mockResolvedValue([{ productId: "p1", factor: 12 }]);
    await expect(
      declareTransfer("co", "u1", { fromLocationId: "d1", toLocationId: "v1", lines: [{ productId: "p1", qty: 5 }] } as any)
    ).rejects.toThrow("pack_only_qty");
  });

  it("whole packs pass the pack-only rule and reach the transaction", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ vanBindingMode: "LOCKED", multiDepotEnabled: true, pieceSalesEnabled: false, expiryEnabled: false, transferConfirmRequired: true });
    (prisma.store.findMany as any).mockResolvedValue([{ id: "d1", kind: "DEPOT" }, { id: "v1", kind: "VAN" }]);
    (prisma.user.findFirst as any).mockResolvedValue({ id: "u1", role: "Admin", assignedVans: [] });
    (prisma.product.findMany as any).mockResolvedValue([{ id: "p1" }]);
    (prisma.productUnitConversion.findMany as any).mockResolvedValue([{ productId: "p1", factor: 12 }]);
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        transfer: { create: async () => ({ id: "t1" }), findUniqueOrThrow: async () => ({ id: "t1" }) },
        transferLine: { create: async () => ({ id: "l1" }) },
        stockBatch: { findMany: async () => [] },
        product: { update: async () => ({}) },
      })
    );
    const { consumeStock } = await import("@/lib/inventory/stock");
    (consumeStock as any).mockResolvedValue([{ batchId: "b", qty: 24, unitCost: 10 }]);
    const t = await declareTransfer("co", "u1", { fromLocationId: "d1", toLocationId: "v1", lines: [{ productId: "p1", qty: 24 }] } as any);
    expect(t).toBeDefined();
  });
});

describe("vanDayCash till math (phone declare + PC close must agree)", () => {
  function mockDay(o: Record<string, any>) {
    (prisma.sale.findMany as any).mockResolvedValue(o.sales ?? []);
    (prisma.versement.findMany as any).mockResolvedValue(o.versements ?? []);
    (prisma.expense.findMany as any).mockResolvedValue(o.expenses ?? []);
    (prisma.clientReturn.findMany as any).mockResolvedValue(o.returns ?? []);
    (prisma.dailyClose.findFirst as any).mockResolvedValue(o.close ?? null);
    (prisma.transfer.findMany as any).mockResolvedValue([]);
  }

  it("dueCash = collected + clientPayments − expenses − cashReturns", async () => {
    mockDay({
      sales: [{ total: 1000, paid: 700 }],
      versements: [{ kind: "CLIENT_PAYMENT", amount: 200, transferId: null }],
      expenses: [{ amount: 50 }],
      returns: [{ total: 30 }],
    });
    const live = await vanDayCash("co", "van1", new Date(2026, 9, 6));
    expect(live.expected).toBe(1000);
    expect(live.collected).toBe(700);
    expect(live.dueTotal).toBe(300);
    expect(live.clientPayments).toBe(200);
    // dueCash asserted through closeDay/remit paths below: 700+200-50-30 = 820
    expect(live.collected + live.clientPayments - live.expenses - live.returnsCash).toBe(820);
  });

  it("CASH_COLLECTION versements count as remitted, CLIENT_PAYMENT do not", async () => {
    mockDay({
      versements: [
        { kind: "CASH_COLLECTION", amount: 500, transferId: null },
        { kind: "CLIENT_PAYMENT", amount: 999, transferId: null },
      ],
    });
    const live = await vanDayCash("co", "van1", new Date(2026, 9, 6));
    expect(live.remittedLive).toBe(500);
  });

  it("declareCash on CLOSED day → already_closed (phone gets FAILED, no double declare)", async () => {
    mockDay({ close: { status: "CLOSED" } });
    await expect(declareCash("co", "u1", "Admin", "van1", "2026-10-06", 100)).rejects.toThrow("already_closed");
  });

  it("declareCash bad amount → bad_amount", async () => {
    mockDay({});
    await expect(declareCash("co", "u1", "Admin", "van1", "2026-10-06", -5)).rejects.toThrow("bad_amount");
    await expect(declareCash("co", "u1", "Admin", "van1", "2026-10-06", NaN)).rejects.toThrow("bad_amount");
  });

  it("remitCash bad amount → bad_amount (never a zero handover)", async () => {
    await expect(remitCash("co", "u1", "van1", "2026-10-06", 0)).rejects.toThrow("bad_amount");
  });

  it("remitCash returns remitted live + amount and difference vs dueCash", async () => {
    mockDay({
      sales: [{ total: 1000, paid: 700 }],
      versements: [{ kind: "CASH_COLLECTION", amount: 100, transferId: null }],
    });
    (prisma.versement.create as any).mockResolvedValue({ id: "v1" });
    (prisma.dailyClose.upsert as any).mockResolvedValue({});
    const r = await remitCash("co", "u1", "van1", "2026-10-06", 200);
    // dueCash = 700, remitted = 100+200 = 300, difference = -400
    expect(r).toMatchObject({ remitted: 300, difference: -400 });
  });

  it("closeDay on already CLOSED → already_closed", async () => {
    mockDay({ close: { status: "CLOSED" } });
    await expect(closeDay("co", "u1", "van1", "2026-10-06")).rejects.toThrow("already_closed");
  });

  it("closeDay snapshots live numbers incl. handovers", async () => {
    mockDay({ sales: [{ total: 500, paid: 500 }], versements: [{ kind: "CASH_COLLECTION", amount: 500, transferId: null }] });
    (prisma.dailyClose.upsert as any).mockImplementation(async (a: any) => a);
    const row: any = await closeDay("co", "u1", "van1", "2026-10-06");
    expect(row.update ?? row.create).toMatchObject({ status: "CLOSED", remitted: 500 });
  });
});
