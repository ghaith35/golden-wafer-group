import { describe, expect, it, vi } from "vitest";
import { addStock, consumeStock, locationQty, weightedCost } from "@/lib/inventory/stock";

function txWithBatches(batches: Array<{ id: string; qty: number; unitCost: number }>) {
  const updates: Array<{ id: string; take: number }> = [];
  return {
    updates,
    tx: {
      stockBatch: {
        findMany: vi.fn(async () => batches.map((b) => ({ ...b, qty: String(b.qty), unitCost: String(b.unitCost) }))),
        update: vi.fn(async (a: any) => {
          updates.push({ id: a.where.id, take: Number(a.data.qty.decrement) });
          return {};
        }),
        create: vi.fn(async (a: any) => a.data),
        aggregate: vi.fn(async () => ({ _sum: { qty: 42.5 } })),
      },
    } as any,
  };
}

describe("weightedCost — margin snapshot on every synced ticket", () => {
  it("empty → 0 (no division by zero on free lines)", () => {
    expect(weightedCost([])).toBe(0);
  });
  it("single batch → its cost", () => {
    expect(weightedCost([{ batchId: "b", qty: 10, unitCost: 100 }])).toBe(100);
  });
  it("FIFO mix: (10×100 + 5×160) / 15 = 120", () => {
    expect(
      weightedCost([
        { batchId: "a", qty: 10, unitCost: 100 },
        { batchId: "b", qty: 5, unitCost: 160 },
      ])
    ).toBeCloseTo(120, 9);
  });
});

describe("consumeStock — FIFO the phone depends on", () => {
  it("consumes oldest first, partial take on last batch", async () => {
    const { tx, updates } = txWithBatches([
      { id: "old", qty: 10, unitCost: 100 },
      { id: "new", qty: 10, unitCost: 200 },
    ]);
    const out = await consumeStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: 12, fefo: false });
    expect(out).toEqual([
      { batchId: "old", qty: 10, unitCost: 100 },
      { batchId: "new", qty: 2, unitCost: 200 },
    ]);
    expect(updates).toEqual([{ id: "old", take: 10 }, { id: "new", take: 2 }]);
  });

  it("exact stock → fully consumed, no leftover update", async () => {
    const { tx, updates } = txWithBatches([{ id: "only", qty: 5, unitCost: 50 }]);
    const out = await consumeStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: 5, fefo: false });
    expect(out).toHaveLength(1);
    expect(updates).toEqual([{ id: "only", take: 5 }]);
  });

  it("CRITICAL: short stock throws insufficient_stock with available (sync marks FAILED, no negative depot)", async () => {
    const { tx, updates } = txWithBatches([{ id: "only", qty: 3, unitCost: 50 }]);
    const err = await consumeStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: 5, fefo: false }).catch((e) => e);
    expect(err.message).toBe("insufficient_stock");
    expect(err.available).toBe(3);
    expect(updates).toEqual([]); // nothing consumed on failure
  });

  it("zero stock → available 0", async () => {
    const { tx } = txWithBatches([]);
    const err = await consumeStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: 1, fefo: false }).catch((e) => e);
    expect(err.message).toBe("insufficient_stock");
    expect(err.available).toBe(0);
  });

  it("FEFO asks DB for expiry ordering (perishables)", async () => {
    const { tx } = txWithBatches([{ id: "a", qty: 10, unitCost: 1 }]);
    await consumeStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: 1, fefo: true });
    const orderBy = (tx.stockBatch.findMany as any).mock.calls[0][0].orderBy;
    expect(JSON.stringify(orderBy)).toContain("expiryDate");
  });

  it("FIFO asks DB for createdAt ordering", async () => {
    const { tx } = txWithBatches([{ id: "a", qty: 10, unitCost: 1 }]);
    await consumeStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: 1, fefo: false });
    expect((tx.stockBatch.findMany as any).mock.calls[0][0]).toMatchObject({ orderBy: { createdAt: "asc" } });
  });
});

describe("addStock — restock / oversell-negative batches", () => {
  it("positive qty keeps its unitCost", async () => {
    const { tx } = txWithBatches([]);
    await addStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: 5, unitCost: 120 });
    expect((tx.stockBatch.create as any).mock.calls[0][0].data).toMatchObject({ qty: 5, unitCost: 120 });
  });
  it("negative qty (van oversell) forces unitCost 0 — cost snapshot stays honest", async () => {
    const { tx } = txWithBatches([]);
    await addStock(tx, { companyId: "c", locationId: "v", productId: "p", qty: -3, unitCost: 120 });
    expect((tx.stockBatch.create as any).mock.calls[0][0].data).toMatchObject({ qty: -3, unitCost: 0 });
  });
});

describe("locationQty", () => {
  it("returns summed qty as number", async () => {
    const { tx } = txWithBatches([]);
    await expect(locationQty(tx, "c", "v", "p")).resolves.toBe(42.5);
  });
});
