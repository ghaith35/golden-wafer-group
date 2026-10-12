import { beforeEach, describe, expect, it, vi } from "vitest";

// Money guards on every synced ticket/order: overpaid / cash-only /
// credit-limit / QR / remise. A phone with a stale snapshot must get a
// clear FAILED reason — never silent wrong debt.

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    store: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    tournee: { findFirst: vi.fn(async () => null) },
    product: { findMany: vi.fn(), findFirst: vi.fn() },
    priceTier: { findFirst: vi.fn(async () => null) },
    productUnitConversion: { findMany: vi.fn(async () => []) },
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
import { createOrder, createTicket } from "@/lib/sales/service";

const SETTINGS = {
  remiseEnabled: true,
  creditSalesEnabled: true,
  debtTrackingEnabled: true,
  qrStrictMode: false,
  oversellAllowed: true,
  expiryEnabled: false,
  transferConfirmRequired: true,
  pieceSalesEnabled: true,
  posEnabled: true,
};

function product(id = "p1", salePrice = 100) {
  return { id, salePrice, tierPrices: [], baseUnitId: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getOrCreateSettings as any).mockResolvedValue({ ...SETTINGS });
  (prisma.user.findFirst as any).mockResolvedValue({ id: "u1", role: "Admin", assignedVans: [] });
  (prisma.store.findFirst as any).mockResolvedValue({ id: "van1", kind: "VAN" });
  (prisma.customer.findFirst as any).mockResolvedValue({ id: "c1", isActive: true, tierId: null, balance: "0", creditLimit: "0" });
  (prisma.product.findMany as any).mockResolvedValue([product()]);
  (prisma.priceTier.findFirst as any).mockResolvedValue(null);
  // $transaction runs the callback with a fake tx that records writes.
  (prisma.$transaction as any).mockImplementation(async (cb: any) => {
    const writes: any[] = [];
    const tx = {
      sale: { create: vi.fn(async (a: any) => ({ id: "sale1", ...a.data, _writes: writes })) },
      product: { update: vi.fn(async () => ({})), findUniqueOrThrow: vi.fn(async () => ({ costPrice: 60 })) },
      customer: { update: vi.fn(async (a: any) => { writes.push(a); return {}; }) },
      tourneeStop: { findUnique: vi.fn(async () => null) },
    };
    const out = await cb(tx);
    (out as any)._tx = tx;
    return out;
  });
});

const ticket = (over: Record<string, unknown> = {}) => ({
  locationId: "van1",
  channel: "VAN",
  qrScanned: true,
  lines: [{ productId: "p1", qty: 2 }],
  ...over,
});

describe("createTicket money guards (phone → PC)", () => {
  it("CRITICAL: base-unit sale prices at factor 1 (no bad_unit without packs)", async () => {
    // Phone sends unitId = base unit id; there is no conversion row for it.
    (prisma.product.findMany as any).mockResolvedValue([{ id: "p1", salePrice: 100, tierPrices: [], baseUnitId: "u-base" }]);
    const res = await createTicket("co", "u1", ticket({ lines: [{ productId: "p1", unitId: "u-base", qty: 2 }] }) as any);
    expect(res).toBeDefined();
  });

  it("unknown pack unit still rejected (bad_unit)", async () => {
    (prisma.product.findMany as any).mockResolvedValue([{ id: "p1", salePrice: 100, tierPrices: [], baseUnitId: "u-base" }]);
    await expect(
      createTicket("co", "u1", ticket({ lines: [{ productId: "p1", unitId: "u-nope", qty: 2 }] }) as any)
    ).rejects.toThrow("bad_unit");
  });

  it("overpaid throws before touching stock (no phantom sale)", async () => {
    await expect(createTicket("co", "u1", ticket({ paid: 10000 }) as any)).rejects.toThrow("overpaid");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("tiny float dust over total is NOT overpaid (1150/12 splits)", async () => {
    // 2 × 100 = 200 total, pay 200.004 → within MONEY_EPS → accepted.
    const res = await createTicket("co", "u1", ticket({ paid: 200.004 }) as any);
    expect(res).toBeDefined();
  });

  it("cash-only shop: unpaid ticket without client rules → cash_only", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ ...SETTINGS, creditSalesEnabled: false });
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    await expect(createTicket("co", "u1", ticket({ clientId: null, paid: 0, qrScanned: true }) as any)).rejects.toThrow("cash_only");
  });

  it("credit sale needs a client → client_required", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    await expect(createTicket("co", "u1", ticket({ clientId: null, paid: 0 }) as any)).rejects.toThrow("client_required");
  });

  it("CRITICAL: credit limit enforced (phone with stale balance gets FAILED, debt never exceeds ceiling)", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue({ id: "c1", isActive: true, tierId: null, balance: "900", creditLimit: "1000" });
    // total 200, paid 0 → due 200 → 900+200 > 1000 → reject.
    await expect(createTicket("co", "u1", ticket({ clientId: "c1", paid: 0 }) as any)).rejects.toThrow("credit_limit_exceeded");
  });

  it("unlimited credit (limit 0) allows any due", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue({ id: "c1", isActive: true, tierId: null, balance: "5000", creditLimit: "0" });
    const res = await createTicket("co", "u1", ticket({ clientId: "c1", paid: 0 }) as any);
    expect(res).toBeDefined();
  });

  it("QR strict: van sale without scan → qr_required (no silent off-list sale)", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ ...SETTINGS, qrStrictMode: true });
    await expect(createTicket("co", "u1", ticket({ clientId: "c1", qrScanned: false }) as any)).rejects.toThrow("qr_required");
  });

  it("QR lax: van sale without scan passes and flags offList", async () => {
    const res: any = await createTicket("co", "u1", ticket({ clientId: "c1", qrScanned: false }) as any);
    expect(res.offList).toBe(true);
  });

  it("remise disabled: any remise → remise_disabled", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ ...SETTINGS, remiseEnabled: false });
    await expect(createTicket("co", "u1", ticket({ remise: 10 }) as any)).rejects.toThrow("remise_disabled");
  });

  it("CRITICAL: partial cash books exact debt once (total 200, paid 150 → balance +50)", async () => {
    const res: any = await createTicket("co", "u1", ticket({ clientId: "c1", paid: 150 }) as any);
    const custUpdate = (res._tx.customer.update as any).mock.calls[0][0];
    expect(custUpdate).toMatchObject({ where: { id: "c1" }, data: { balance: { increment: 50 } } });
  });

  it("full cash books no debt", async () => {
    const res: any = await createTicket("co", "u1", ticket({ clientId: "c1", paid: 200 }) as any);
    expect((res._tx.customer.update as any)).not.toHaveBeenCalled();
  });

  it("piece rule: packed product sold loose while pieceSalesEnabled OFF → piece_sale_forbidden", async () => {
    (getOrCreateSettings as any).mockResolvedValue({ ...SETTINGS, pieceSalesEnabled: false });
    (prisma.product.findMany as any).mockResolvedValue([{ id: "p1", salePrice: 100, tierPrices: [], baseUnitId: "base1" }]);
    (prisma.productUnitConversion.findMany as any).mockResolvedValue([{ productId: "p1", unitId: "pack1", factor: 12 }]);
    await expect(
      createTicket("co", "u1", ticket({ lines: [{ productId: "p1", unitId: "base1", qty: 1 }] }) as any)
    ).rejects.toThrow("piece_sale_forbidden");
  });
});

describe("createOrder guards", () => {
  it("unknown/inactive client → bad_client", async () => {
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    await expect(createOrder("co", { clientId: "ghost", lines: [{ productId: "p1", qty: 1 }] } as any)).rejects.toThrow("bad_client");
  });

  it("overpaid order → overpaid", async () => {
    await expect(
      createOrder("co", { clientId: "c1", paid: 99999, lines: [{ productId: "p1", qty: 1 }] } as any)
    ).rejects.toThrow("overpaid");
  });
});
