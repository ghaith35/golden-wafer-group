import { describe, expect, it } from "vitest";
import { aggregateVanReport } from "@/lib/reports/vanReport";

describe("aggregateVanReport (sales by van)", () => {
  it("sums sales, profit, expenses, hours, products + top", () => {
    const r = aggregateVanReport({
      sales: [
        { total: 1000, paid: 800 },
        { total: 500, paid: 500 },
      ],
      lines: [
        { productId: "p1", baseQty: 10, lineTotal: 1000, unitCost: 60, product: { name: "Huile", reference: "H1" } },
        { productId: "p2", baseQty: 5, lineTotal: 500, unitPrice: 0, unitCost: 70, product: { name: "Sucre", reference: null } } as never,
      ],
      expenses: [{ amount: 120 }, { amount: 30 }],
      tournees: [
        { startedAt: "2026-10-10T07:00:00.000Z", finishedAt: "2026-10-10T15:30:00.000Z" },
        { startedAt: "2026-10-11T07:00:00.000Z", finishedAt: null },
      ],
    });
    expect(r).toMatchObject({
      sales: 2, total: 1500, paid: 1300, due: 200,
      profit: (1000 - 600) + (500 - 350),
      expenses: 150, hours: 8.5, days: 2,
    });
    expect(r.products.map((p) => p.name)).toEqual(["Huile", "Sucre"]);
    expect(r.top?.name).toBe("Huile");
    expect(r.top).toMatchObject({ qty: 10, revenue: 1000, profit: 400 });
  });

  it("empty van → zeros, null top, never NaN on garbage", () => {
    const r = aggregateVanReport({
      sales: [], lines: [], expenses: [], tournees: [{ startedAt: "xx", finishedAt: null }],
    });
    expect(r).toMatchObject({ sales: 0, total: 0, profit: 0, expenses: 0, hours: 0, days: 0, top: null });
    expect(r.products).toEqual([]);
    const g = aggregateVanReport({
      sales: [{ total: "abc", paid: null }],
      lines: [{ productId: "p", baseQty: "x", lineTotal: null, unitCost: undefined, product: null }],
      expenses: [{ amount: "nan" }],
      tournees: [],
    });
    expect(g.total).toBe(0);
    expect(g.profit).toBe(0);
    expect(g.products[0]).toMatchObject({ name: "", qty: 0 });
  });
});
