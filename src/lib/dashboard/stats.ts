/// Pure dashboard aggregation (owner command centre). Server fetches raw
/// delivered sales / expenses; everything else (periods, previous-period
/// deltas, rankings per product / van / client, 30-day trend, per-van
/// drill-down) is computed here so it can be unit-tested without a database.
///
/// Definitions (same as /reports):
///   revenue (chiffre d'affaires) = Σ sale.total   (DELIVERY + TICKET, DELIVERED)
///   profit  (bénéfice brut)      = revenue − Σ baseQty × unitCost (COGS snapshot)
///   net     (après dépenses)     = profit − expenses in the period

export type Period = "day" | "week" | "month";
export const PERIODS: Period[] = ["day", "week", "month"];
export type Channel = "DEPOT" | "VAN" | "POS";

export type RawLine = {
  productId: string;
  baseQty: unknown;
  lineTotal: unknown;
  unitCost: unknown;
  product: { name: string } | null;
};
export type RawSale = {
  id: string;
  number: string;
  date: Date;
  total: unknown;
  paid: unknown;
  channel: string;
  locationId: string | null;
  clientId: string | null;
  client: { name: string } | null;
  lines: RawLine[];
};
export type RawExpense = { amount: unknown; expenseDate: Date; locationId: string | null };
export type RawVan = { id: string; name: string; matricule: string | null; isActive: boolean; driver: string | null };

export type Agg = { revenue: number; profit: number; count: number; paid: number; expenses: number };
export type ProductStat = { id: string; name: string; qty: number; revenue: number; profit: number };
export type ClientStat = { id: string; name: string; revenue: number; profit: number; count: number };
export type VanStat = { id: string; name: string; matricule: string; revenue: number; profit: number; count: number };

export type VanPeriod = Agg & { products: ProductStat[]; clients: ClientStat[] };
export type VanBlock = {
  id: string;
  name: string;
  matricule: string;
  driver: string;
  periods: Record<Period, VanPeriod>;
  /// Last 14 days, oldest first.
  trend: Array<{ r: number; p: number }>;
};

export type DashboardData = {
  nowIso: string;
  periods: Record<Period, { cur: Agg; prev: Agg }>;
  /// Last 30 days, oldest first.
  trend: Array<{ date: string; revenue: number; profit: number }>;
  channels: Record<Period, Record<Channel, number>>;
  top: Record<Period, { products: ProductStat[]; clients: ClientStat[]; vans: VanStat[] }>;
  vans: VanBlock[];
  /// Sales not made from a van (depot counter / POS / unassigned).
  other: Record<Period, Agg>;
  recent: Array<{ id: string; number: string; dateIso: string; total: number; client: string; van: string; channel: string }>;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/// Week starts on Sunday (Algerian working week).
export function weekStart(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -s.getDay());
}

/// Earliest instant the server must load so every comparison window exists.
export function dashboardSince(now: Date): Date {
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const wk = addDays(weekStart(now), -7);
  const thirty = addDays(startOfDay(now), -29);
  return new Date(Math.min(prevMonth.getTime(), wk.getTime(), thirty.getTime()));
}

type Range = { start: Date; end: Date; prevStart: Date; prevEnd: Date };
function ranges(now: Date): Record<Period, Range> {
  const dayS = startOfDay(now);
  const wkS = weekStart(now);
  const moS = new Date(now.getFullYear(), now.getMonth(), 1);
  const win = (start: Date, prevStart: Date): Range => ({
    start,
    end: now,
    prevStart,
    // Same elapsed span so "week so far" is compared with "last week so far".
    prevEnd: new Date(prevStart.getTime() + (now.getTime() - start.getTime())),
  });
  return {
    day: win(dayS, addDays(dayS, -1)),
    week: win(wkS, addDays(wkS, -7)),
    month: win(moS, new Date(now.getFullYear(), now.getMonth() - 1, 1)),
  };
}

const emptyAgg = (): Agg => ({ revenue: 0, profit: 0, count: 0, paid: 0, expenses: 0 });

function saleCogs(s: RawSale): number {
  let c = 0;
  for (const l of s.lines) c += num(l.baseQty) * num(l.unitCost);
  return c;
}

function addSale(a: Agg, s: RawSale) {
  const total = num(s.total);
  a.revenue += total;
  a.profit += total - saleCogs(s);
  a.count += 1;
  a.paid += num(s.paid);
}

function inRange(d: Date, from: Date, to: Date) {
  const t = d.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function rankProducts(sales: RawSale[]): ProductStat[] {
  const m = new Map<string, ProductStat>();
  for (const s of sales) {
    for (const l of s.lines) {
      const e = m.get(l.productId) ?? { id: l.productId, name: l.product?.name ?? "—", qty: 0, revenue: 0, profit: 0 };
      const rev = num(l.lineTotal);
      e.qty += num(l.baseQty);
      e.revenue += rev;
      e.profit += rev - num(l.baseQty) * num(l.unitCost);
      if (l.product?.name) e.name = l.product.name;
      m.set(l.productId, e);
    }
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
}

function rankClients(sales: RawSale[]): ClientStat[] {
  const m = new Map<string, ClientStat>();
  for (const s of sales) {
    // Walk-in / anonymous tickets are not a "client" to rank.
    if (!s.clientId) continue;
    const e = m.get(s.clientId) ?? { id: s.clientId, name: s.client?.name ?? "—", revenue: 0, profit: 0, count: 0 };
    const total = num(s.total);
    e.revenue += total;
    e.profit += total - saleCogs(s);
    e.count += 1;
    m.set(s.clientId, e);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
}

export function buildDashboard(args: {
  now: Date;
  sales: RawSale[];
  expenses: RawExpense[];
  vans: RawVan[];
}): DashboardData {
  const { now, sales, expenses, vans } = args;
  const R = ranges(now);
  const vanIds = new Set(vans.map((v) => v.id));
  const vanName = new Map(vans.map((v) => [v.id, v.name]));

  const periods = {} as DashboardData["periods"];
  const channels = {} as DashboardData["channels"];
  const top = {} as DashboardData["top"];
  const other = {} as DashboardData["other"];
  const vanBlocks: VanBlock[] = vans.map((v) => ({
    id: v.id,
    name: v.name,
    matricule: v.matricule ?? "",
    driver: v.driver ?? "",
    periods: {
      day: { ...emptyAgg(), products: [], clients: [] },
      week: { ...emptyAgg(), products: [], clients: [] },
      month: { ...emptyAgg(), products: [], clients: [] },
    },
    trend: Array.from({ length: 14 }, () => ({ r: 0, p: 0 })),
  }));
  const vanIdx = new Map(vanBlocks.map((v, i) => [v.id, i]));

  for (const p of PERIODS) {
    const r = R[p];
    const cur = emptyAgg();
    const prev = emptyAgg();
    const ch: Record<Channel, number> = { DEPOT: 0, VAN: 0, POS: 0 };
    const oth = emptyAgg();
    const inP: RawSale[] = [];
    const perVan = new Map<string, RawSale[]>();
    for (const s of sales) {
      if (inRange(s.date, r.start, r.end)) {
        addSale(cur, s);
        inP.push(s);
        const c = (s.channel as Channel) in ch ? (s.channel as Channel) : "DEPOT";
        ch[c] += num(s.total);
        if (s.locationId && vanIds.has(s.locationId)) {
          const arr = perVan.get(s.locationId) ?? [];
          arr.push(s);
          perVan.set(s.locationId, arr);
        } else {
          addSale(oth, s);
        }
      } else if (inRange(s.date, r.prevStart, r.prevEnd)) {
        addSale(prev, s);
      }
    }
    for (const e of expenses) {
      const amt = num(e.amount);
      if (inRange(e.expenseDate, r.start, r.end)) {
        cur.expenses += amt;
        const i = e.locationId ? vanIdx.get(e.locationId) : undefined;
        if (i !== undefined) vanBlocks[i].periods[p].expenses += amt;
        else oth.expenses += amt;
      } else if (inRange(e.expenseDate, r.prevStart, r.prevEnd)) {
        prev.expenses += amt;
      }
    }
    periods[p] = { cur, prev };
    channels[p] = ch;
    other[p] = oth;
    for (const [vid, arr] of perVan) {
      const b = vanBlocks[vanIdx.get(vid)!];
      for (const s of arr) addSale(b.periods[p], s);
      b.periods[p].products = rankProducts(arr).slice(0, 8);
      b.periods[p].clients = rankClients(arr).slice(0, 8);
    }
    const vanStats: VanStat[] = vanBlocks
      .filter((b) => b.periods[p].count > 0)
      .map((b) => ({
        id: b.id,
        name: b.name,
        matricule: b.matricule,
        revenue: b.periods[p].revenue,
        profit: b.periods[p].profit,
        count: b.periods[p].count,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    top[p] = { products: rankProducts(inP), clients: rankClients(inP), vans: vanStats };
  }
  void vanName;

  // 30-day company trend + 14-day per-van trend.
  const today = startOfDay(now);
  const trend: DashboardData["trend"] = [];
  const trendIdx = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i);
    trendIdx.set(dayKey(d), trend.length);
    trend.push({ date: dayKey(d), revenue: 0, profit: 0 });
  }
  for (const s of sales) {
    const k = dayKey(s.date);
    const ti = trendIdx.get(k);
    const total = num(s.total);
    const profit = total - saleCogs(s);
    if (ti !== undefined) {
      trend[ti].revenue += total;
      trend[ti].profit += profit;
    }
    const vi = s.locationId ? vanIdx.get(s.locationId) : undefined;
    if (vi !== undefined && ti !== undefined && ti >= 16) {
      const cell = vanBlocks[vi].trend[ti - 16];
      cell.r += total;
      cell.p += profit;
    }
  }

  // Active vans first by month revenue; inactive vans only if they sold.
  const visibleVans = vanBlocks
    .filter((b) => vans[vanIdx.get(b.id)!].isActive || b.periods.month.count > 0 || b.periods.week.count > 0)
    .sort((a, b) => b.periods.month.revenue - a.periods.month.revenue || a.name.localeCompare(b.name));

  const recent = [...sales]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 12)
    .map((s) => ({
      id: s.id,
      number: s.number,
      dateIso: s.date.toISOString(),
      total: num(s.total),
      client: s.client?.name ?? "",
      van: s.locationId ? vanName.get(s.locationId) ?? "" : "",
      channel: s.channel,
    }));

  return { nowIso: now.toISOString(), periods, trend, channels, top, vans: visibleVans, other, recent };
}
