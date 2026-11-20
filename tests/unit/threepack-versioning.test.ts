import { beforeEach, describe, expect, it, vi } from "vitest";

// Offline correctness: a van phone sells under the rule it had; the admin edits
// that rule before the phone syncs. The sale (goods already handed over) must
// still be accepted — so rules are immutable and edits create a new version.

vi.mock("@/lib/db", () => ({
  prisma: {
    threePackRule: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    product: { count: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { replaceRule } from "@/lib/threepack/admin";
import { applyThreePack } from "@/lib/threepack/service";

type MockFn = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as MockFn;

const OLD_ITEMS = [
  { role: "BUY", productId: "pA", colis: 10 },
  { role: "GIVE", productId: "pA", colis: 1 },
];
const existing = { id: "old", companyId: "co", name: "10 → 1", mode: "SINGLE", isActive: true, isArchived: false, items: OLD_ITEMS };

beforeEach(() => {
  vi.clearAllMocks();
  m(prisma.product.count).mockResolvedValue(1);
  m(prisma.product.findMany).mockResolvedValue([{ id: "pA", baseUnitId: "u-bottle", conversions: [{ unitId: "u-carton", factor: 12 }] }]);
  m(prisma.$transaction).mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      threePackRule: {
        update: prisma.threePackRule.update,
        create: vi.fn(async () => ({ id: "new" })),
      },
    }),
  );
});

describe("replaceRule — rules are immutable", () => {
  it("changing the quantities archives the old rule and creates a new one", async () => {
    m(prisma.threePackRule.findFirst).mockResolvedValue(existing);
    const r = await replaceRule("co", "old", {
      name: "20 → 1",
      mode: "SINGLE",
      items: [{ role: "BUY", productId: "pA", colis: 20 }, { role: "GIVE", productId: "pA", colis: 1 }],
    });
    expect(r).toEqual({ id: "new", versioned: true });
    expect(prisma.threePackRule.update).toHaveBeenCalledWith({ where: { id: "old" }, data: { isActive: false, isArchived: true } });
  });

  it("a name-only edit updates in place (no new version)", async () => {
    m(prisma.threePackRule.findFirst).mockResolvedValue(existing);
    const r = await replaceRule("co", "old", { name: "Renamed", mode: "SINGLE", items: [...OLD_ITEMS].reverse() as never });
    expect(r).toEqual({ id: "old", versioned: false });
    expect(prisma.threePackRule.update).toHaveBeenCalledWith({ where: { id: "old" }, data: { name: "Renamed", isActive: true } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("an archived rule can no longer be edited", async () => {
    m(prisma.threePackRule.findFirst).mockResolvedValue(null);
    await expect(replaceRule("co", "old", { name: "x", mode: "SINGLE", items: OLD_ITEMS as never })).rejects.toThrow("not_found");
  });

  it("the new version keeps the old on/off state", async () => {
    m(prisma.threePackRule.findFirst).mockResolvedValue({ ...existing, isActive: false });
    const created = vi.fn(async () => ({ id: "new" }));
    m(prisma.$transaction).mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ threePackRule: { update: vi.fn(), create: created } }));
    await replaceRule("co", "old", { name: "20 → 1", mode: "SINGLE", items: [{ role: "BUY", productId: "pA", colis: 20 }, { role: "GIVE", productId: "pA", colis: 1 }] });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });
});

describe("offline sale vs a rule edited before sync", () => {
  const archivedOld = { id: "old", name: "10 → 1", mode: "SINGLE", isActive: false, isArchived: true, items: OLD_ITEMS };
  const activeNew = {
    id: "new", name: "20 → 1", mode: "SINGLE", isActive: true, isArchived: false,
    items: [{ role: "BUY", productId: "pA", colis: 20 }, { role: "GIVE", productId: "pA", colis: 1 }],
  };
  const line = (qty: number, extra: Record<string, unknown> = {}) => ({
    productId: "pA", unitId: "u-carton", qty, baseQty: qty * 12, unitPrice: extra.bonusRuleId ? 0 : 1200, remise: 0, lineTotal: 0, ...extra,
  });

  it("the phone's sale under the OLD rule is accepted after the admin raised the threshold", async () => {
    // Sync validation loads ALL rules (archived included).
    m(prisma.threePackRule.findMany).mockResolvedValue([archivedOld, activeNew]);
    const lines = [line(10), line(1, { isBonus: true, bonusRuleId: "old" })];
    await expect(applyThreePack("co", { threePackEnabled: true }, lines, { fromSync: true })).resolves.toHaveLength(2);
  });

  it("…but claiming the NEW rule's gift on 10 colis is still rejected", async () => {
    m(prisma.threePackRule.findMany).mockResolvedValue([archivedOld, activeNew]);
    const lines = [line(10), line(1, { isBonus: true, bonusRuleId: "new" })];
    await expect(applyThreePack("co", { threePackEnabled: true }, lines, { fromSync: true })).rejects.toThrow("bonus_not_earned");
  });

  it("sync validation loads inactive/archived rules; online sales load ACTIVE rules only", async () => {
    m(prisma.threePackRule.findMany).mockResolvedValue([archivedOld, activeNew]);
    await applyThreePack("co", { threePackEnabled: true }, [line(10), line(1, { isBonus: true, bonusRuleId: "old" })], { fromSync: true });
    expect(m(prisma.threePackRule.findMany).mock.calls[0][0].where).toEqual({ companyId: "co" });

    m(prisma.threePackRule.findMany).mockClear();
    m(prisma.threePackRule.findMany).mockResolvedValue([activeNew]);
    await applyThreePack("co", { threePackEnabled: true }, [line(10)], { fromSync: false });
    expect(m(prisma.threePackRule.findMany).mock.calls[0][0].where).toEqual({ companyId: "co", isActive: true });
  });
});
