import { beforeEach, describe, expect, it, vi } from "vitest";

// 3pack on the server: gifts are computed by the SERVER (a client can never
// mint free goods), land as price-0 lines, and consume stock like any line.

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    store: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    tournee: { findFirst: vi.fn(async () => null) },
    product: { findMany: vi.fn() },
    priceTier: { findFirst: vi.fn(async () => null) },
    productUnitConversion: { findMany: vi.fn() },
    threePackRule: { findMany: vi.fn() },
    sale: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/settings/helpers", () => ({ getOrCreateSettings: vi.fn() }));
vi.mock("@/lib/docs/sequences", () => ({
  nextDocNumber: vi.fn(async () => "TCK-2026-0001"),
  ensureSeasonFor: vi.fn(async () => ({ id: "season1" })),
}));
vi.mock("@/lib/inventory/stock", () => ({
  consumeStock: vi.fn(async () => [{ batchId: "b", qty: 1, unitCost: 60 }]),
  addStock: vi.fn(async () => ({})),
  weightedCost: vi.fn(() => 60),
}));

import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { consumeStock } from "@/lib/inventory/stock";
import { createTicket } from "@/lib/sales/service";

type MockFn = ReturnType<typeof vi.fn>;
const mocked = (f: unknown) => f as MockFn;
type Line = Record<string, unknown> & { qty?: number; isBonus?: boolean };
type Sale = { lines: { create: Line[] }; total: unknown };
type TicketInput = Parameters<typeof createTicket>[2];

const SETTINGS = {
  remiseEnabled: true, creditSalesEnabled: true, debtTrackingEnabled: true, qrStrictMode: false,
  oversellAllowed: true, expiryEnabled: false, transferConfirmRequired: true, pieceSalesEnabled: true,
  posEnabled: true, threePackEnabled: true,
};

// Product A: base unit bottle, carton = 12 bottles, 100 DA / bottle.
const PRODUCT_A = { id: "pA", salePrice: 100, tierPrices: [], baseUnitId: "u-bottle" };
const CONVERSIONS = [{ productId: "pA", unitId: "u-carton", factor: 12 }];
const RULE = {
  id: "r1", name: "10 → 1", mode: "SINGLE", isActive: true,
  items: [{ role: "BUY", productId: "pA", colis: 10 }, { role: "GIVE", productId: "pA", colis: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked(getOrCreateSettings).mockResolvedValue({ ...SETTINGS });
  mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", role: "Admin", assignedVans: [] });
  mocked(prisma.store.findFirst).mockResolvedValue({ id: "van1", kind: "VAN" });
  mocked(prisma.customer.findFirst).mockResolvedValue({ id: "c1", isActive: true, tierId: null, balance: "0", creditLimit: "0" });
  // priceLines asks for tierPrices (include); loadColis asks for conversions (select).
  mocked(prisma.product.findMany).mockImplementation(async (args: { select?: unknown } | undefined) =>
    args?.select ? [{ id: "pA", baseUnitId: "u-bottle", conversions: [{ unitId: "u-carton", factor: 12 }] }] : [PRODUCT_A],
  );
  mocked(prisma.productUnitConversion.findMany).mockResolvedValue(CONVERSIONS);
  mocked(prisma.threePackRule.findMany).mockResolvedValue([RULE]);
  mocked(prisma.$transaction).mockImplementation(async (cb: (tx: unknown) => unknown) => {
    const tx = {
      sale: { create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "sale1", ...a.data })) },
      product: { update: vi.fn(async () => ({})), findUniqueOrThrow: vi.fn(async () => ({ costPrice: 60 })) },
      customer: { update: vi.fn(async () => ({})) },
      tourneeStop: { findUnique: vi.fn(async () => null) },
    };
    return cb(tx);
  });
});

const ticket = (lines: unknown[]) => ({ locationId: "van1", channel: "VAN", qrScanned: true, clientId: "c1", lines });
const buy10 = { productId: "pA", unitId: "u-carton", qty: 10 };
const createdLines = (sale: Sale) => sale.lines.create;
const run = async (lines: unknown[], opts?: { opId: string }) =>
  (await createTicket("co", "u1", ticket(lines) as unknown as TicketInput, opts)) as unknown as Sale;

describe("3pack server authority", () => {
  it("online: the server adds the gift itself (price 0, colis unit, total unchanged)", async () => {
    const sale = await run([buy10]);
    const lines = createdLines(sale);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty: 10, unitPrice: 1200, lineTotal: 12000, isBonus: false });
    expect(lines[1]).toMatchObject({ productId: "pA", unitId: "u-carton", qty: 1, baseQty: 12, unitPrice: 0, lineTotal: 0, isBonus: true, bonusRuleId: "r1" });
    expect(Number(sale.total)).toBe(12000);
  });

  it("the gift is deducted from stock like any line (purchase 120 + gift 12 base units)", async () => {
    await run([buy10]);
    const qtys = mocked(consumeStock).mock.calls.map((c: Array<{ qty: number }>) => c[1].qty).sort((a: number, b: number) => a - b);
    expect(qtys).toEqual([12, 120]);
  });

  it("every multiple counts: 25 colis → 2 free", async () => {
    const sale = await run([{ ...buy10, qty: 25 }]);
    expect(createdLines(sale)[1]).toMatchObject({ qty: 2, baseQty: 24, isBonus: true });
  });

  it("below the threshold: no gift", async () => {
    const sale = await run([{ ...buy10, qty: 9 }]);
    expect(createdLines(sale)).toHaveLength(1);
  });

  it("a forged bonus line from an online client is dropped and recomputed", async () => {
    const forged = { productId: "pA", unitId: "u-carton", qty: 50, unitPrice: 0, bonusRuleId: "r1" };
    const sale = await run([{ ...buy10, qty: 9 }, forged]);
    expect(createdLines(sale)).toHaveLength(1); // 9 colis earn nothing
    const sale2 = await run([buy10, forged]);
    expect(createdLines(sale2).filter((l) => l.isBonus).map((l) => l.qty)).toEqual([1]); // not 50
  });

  it("feature OFF: no gift is added and a sent bonus line is dropped", async () => {
    mocked(getOrCreateSettings).mockResolvedValue({ ...SETTINGS, threePackEnabled: false });
    const forged = { productId: "pA", unitId: "u-carton", qty: 1, bonusRuleId: "r1" };
    const sale = await run([buy10, forged]);
    expect(createdLines(sale)).toHaveLength(1);
  });

  it("inactive rules give nothing online", async () => {
    mocked(prisma.threePackRule.findMany).mockResolvedValue([]); // loadRules filters isActive in the query
    const sale = await run([buy10]);
    expect(createdLines(sale)).toHaveLength(1);
  });
});

describe("3pack offline sync (opId): the phone's gifts are honoured but capped", () => {
  const phoneGift = (qty: number, unitPrice = 0) => ({ productId: "pA", unitId: "u-carton", qty, unitPrice, bonusRuleId: "r1" });

  it("exactly what was earned is accepted and forced to price 0", async () => {
    const sale = await run([buy10, phoneGift(1, 999)], { opId: "op1" });
    const gift = createdLines(sale).find((l) => l.isBonus);
    expect(gift).toMatchObject({ qty: 1, unitPrice: 0, lineTotal: 0, bonusRuleId: "r1" });
    expect(Number(sale.total)).toBe(12000);
  });

  it("an over-claim is rejected with bonus_not_earned (never silently accepted)", async () => {
    await expect(run([buy10, phoneGift(3)], { opId: "op2" })).rejects.toThrow("bonus_not_earned");
  });

  it("a rule deactivated after the phone sold is still honoured (rules are soft-deleted)", async () => {
    mocked(prisma.threePackRule.findMany).mockResolvedValue([{ ...RULE, isActive: false }]);
    const sale = await run([buy10, phoneGift(1)], { opId: "op3" });
    expect(createdLines(sale).some((l) => l.isBonus)).toBe(true);
  });

  it("a sync op without any bonus line passes through untouched (no recompute, no surprise gift)", async () => {
    const sale = await run([buy10], { opId: "op4" });
    expect(createdLines(sale)).toHaveLength(1);
  });
});
