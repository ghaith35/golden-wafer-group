import { describe, it, expect } from "vitest";
import { buildDashboard, weekStart, type RawSale } from "@/lib/dashboard/stats";

// Wednesday 2026-11-18 15:00 local.
const NOW = new Date(2026, 10, 18, 15, 0, 0);
const line = (productId: string, name: string, qty: number, total: number, cost: number) => ({
  productId, baseQty: qty, lineTotal: total, unitCost: cost, product: { name },
});
const sale = (id: string, d: Date, locationId: string | null, clientId: string | null, lines: ReturnType<typeof line>[], channel = "VAN"): RawSale => ({
  id, number: id, date: d, total: lines.reduce((s, l) => s + Number(l.lineTotal), 0), paid: 0, channel,
  locationId, clientId, client: clientId ? { name: `C-${clientId}` } : null, lines,
});

describe("dashboard stats", () => {
  it("week starts Sunday", () => {
    expect(weekStart(NOW).getDay()).toBe(0);
    expect(weekStart(NOW).getDate()).toBe(15);
  });

  const vans = [
    { id: "v1", name: "Van 1", matricule: null, isActive: true, driver: null },
    { id: "v2", name: "Van 2", matricule: null, isActive: true, driver: null },
  ];
  const sales = [
    sale("a", new Date(2026, 10, 18, 9), "v1", "c1", [line("p1", "Choco", 10, 1000, 60)]),
    sale("b", new Date(2026, 10, 16, 9), "v2", "c2", [line("p2", "Vanilla", 5, 500, 60), line("p1", "Choco", 2, 200, 60)]),
    sale("c", new Date(2026, 10, 2, 9), "v1", null, [line("p1", "Choco", 1, 100, 60)]),
    sale("d", new Date(2026, 10, 17, 9), null, "c1", [line("p2", "Vanilla", 1, 100, 60)], "DEPOT"),
    sale("old", new Date(2026, 9, 18, 9), "v1", "c1", [line("p1", "Choco", 1, 100, 60)]),
  ];
  const d = buildDashboard({ now: NOW, sales, vans, expenses: [{ amount: 50, expenseDate: new Date(2026, 10, 18, 8), locationId: "v1" }] });

  it("computes revenue and profit per period", () => {
    expect(d.periods.day.cur).toMatchObject({ revenue: 1000, profit: 400, count: 1, expenses: 50 });
    expect(d.periods.week.cur).toMatchObject({ revenue: 1800, profit: 720, count: 3 });
    expect(d.periods.month.cur).toMatchObject({ revenue: 1900, profit: 760, count: 4 });
  });
  it("compares with the previous equal window", () => {
    // yesterday (17th) up to 15:00 → sale d only
    expect(d.periods.day.prev.revenue).toBe(100);
    // last month so far (Oct 1 … Oct 18 15:00) → old
    expect(d.periods.month.prev.revenue).toBe(100);
  });
  it("splits per van and ranks", () => {
    const v1 = d.vans.find((v) => v.id === "v1")!;
    expect(v1.periods.day.revenue).toBe(1000);
    expect(v1.periods.week.revenue).toBe(1000);
    expect(v1.periods.month.revenue).toBe(1100);
    expect(v1.periods.day.expenses).toBe(50);
    expect(d.top.month.vans[0].id).toBe("v1");
    expect(d.top.month.products[0].name).toBe("Choco");
    expect(d.other.month.revenue).toBe(100);
  });
  it("ranks only identified clients", () => {
    expect(d.top.month.clients.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
  it("has a 30-day trend ending today", () => {
    expect(d.trend).toHaveLength(30);
    expect(d.trend[29]).toMatchObject({ date: "2026-11-18", revenue: 1000, profit: 400 });
    expect(d.vans.find((v) => v.id === "v1")!.trend[13].r).toBe(1000);
  });
});
