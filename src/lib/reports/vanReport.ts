/// Pure van-report aggregation (admin "sales by van"): tested here, served
/// by /api/reports?report=van-detail. All money in sale currency units.

export type VanSaleRow = { total: unknown; paid: unknown };
export type VanLineRow = {
  productId: string;
  baseQty: unknown;
  lineTotal: unknown;
  unitCost: unknown;
  product: { name: string; reference: string | null } | null;
};
export type VanExpenseRow = { amount: unknown };
export type VanTourneeRow = { startedAt: unknown; finishedAt: unknown };

export type VanProductStat = {
  name: string;
  ref: string;
  qty: number;
  revenue: number;
  profit: number;
};

export type VanReport = {
  sales: number;
  total: number;
  paid: number;
  due: number;
  profit: number;
  expenses: number;
  hours: number;
  days: number;
  products: VanProductStat[];
  top: VanProductStat | null;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function aggregateVanReport(args: {
  sales: VanSaleRow[];
  lines: VanLineRow[];
  expenses: VanExpenseRow[];
  tournees: VanTourneeRow[];
}): VanReport {
  const { sales, lines, expenses, tournees } = args;
  let total = 0;
  let paid = 0;
  for (const s of sales) {
    total += num(s.total);
    paid += num(s.paid);
  }
  const byProduct = new Map<string, VanProductStat>();
  let profit = 0;
  for (const l of lines) {
    const qty = num(l.baseQty);
    const revenue = num(l.lineTotal);
    const cogs = qty * num(l.unitCost);
    const p = revenue - cogs;
    profit += p;
    const prev = byProduct.get(l.productId) ?? {
      name: l.product?.name ?? "",
      ref: l.product?.reference ?? "",
      qty: 0,
      revenue: 0,
      profit: 0,
    };
    prev.qty += qty;
    prev.revenue += revenue;
    prev.profit += p;
    // Keep the freshest known name.
    if (l.product?.name) prev.name = l.product.name;
    byProduct.set(l.productId, prev);
  }
  let expenseTotal = 0;
  for (const e of expenses) expenseTotal += num(e.amount);
  const days = new Set<string>();
  let hours = 0;
  for (const t of tournees) {
    try {
      const s = new Date(String(t.startedAt)).getTime();
      const f = new Date(String(t.finishedAt)).getTime();
      if (Number.isFinite(s)) days.add(new Date(s).toISOString().slice(0, 10));
      if (Number.isFinite(f)) days.add(new Date(f).toISOString().slice(0, 10));
      if (Number.isFinite(s) && Number.isFinite(f) && f > s) hours += (f - s) / 3600000;
    } catch {
      /* ignore malformed stamps */
    }
  }
  const products = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    sales: sales.length,
    total: round2(total),
    paid: round2(paid),
    due: round2(total - paid),
    profit: round2(profit),
    expenses: round2(expenseTotal),
    hours: Math.round(hours * 10) / 10,
    days: days.size,
    products: products.map((p) => ({ ...p, qty: round2(p.qty), revenue: round2(p.revenue), profit: round2(p.profit) })),
    top: products.length ? { ...products[0], qty: round2(products[0].qty), revenue: round2(products[0].revenue), profit: round2(products[0].profit) } : null,
  };
}
