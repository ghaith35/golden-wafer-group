/// Pure dashboard aggregation (owner command centre). Server fetches raw
/// delivered sales / expenses; everything else (periods, previous-period
/// deltas, rankings per product / van / client, 30-day trend, per-van
/// drill-down) is computed here so it can be unit-tested without a database.
///
/// Definitions (same as /reports):
///   revenue (chiffre d'affaires) = Σ sale.total   (DELIVERY + TICKET, DELIVERED)
///   profit  (bénéfice brut)      = revenue − Σ baseQty × unitCost (COGS snapshot)
///   net     (après dépenses)     = profit − expenses in the period

/// "custom" = the admin's own from/to window (empty unless a range was asked for).
export type Period = "day" | "week" | "month" | "custom";
/// The three always-on windows (cards / table columns); "custom" is added on demand.
export const PERIODS: Period[] = ["day", "week", "month"];
export type CustomRange = { from: string; to: string };
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
  client: { name: string; gpsLat?: number | null; gpsLng?: number | null } | null;
  lines: RawLine[];
};
export type RawExpense = { amount: unknown; expenseDate: Date; locationId: string | null };
export type RawVan = { id: string; name: string; matricule: string | null; isActive: boolean; driver: string | null };

export type Agg = { revenue: number; profit: number; count: number; paid: number; expenses: number };
export type ProductStat = { id: string; name: string; qty: number; revenue: number; profit: number };
export type ClientStat = { id: string; name: string; gpsLat?: number | null; gpsLng?: number | null; revenue: number; profit: number; count: number };
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
  /// The from/to window behind the "custom" period (null = none asked for).
  customRange: { from: string; to: string; days: number } | null;
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
export function dashboardSince(now: Date, custom?: CustomRange | null): Date {
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const wk = addDays(weekStart(now), -7);
  const thirty = addDays(startOfDay(now), -29);
  const times = [prevMonth.getTime(), wk.getTime(), thirty.getTime()];
  const cr = custom ? customWindow(custom) : null;
  if (cr) times.push(cr.prevStart.getTime());
  return new Date(Math.min(...times));
}

const keyToLocal = (key: string, endOfDay = false) => {
  const [y, m, d] = key.split("-").map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d);
};

/// The admin's window [from 00:00, to 23:59:59] and the equally long window
/// right before it (the "previous period" it is compared with).
export function customWindow(c: CustomRange): Range | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.from) || !/^\d{4}-\d{2}-\d{2}$/.test(c.to) || c.from > c.to) return null;
  const start = keyToLocal(c.from);
  const end = keyToLocal(c.to, true);
  const span = end.getTime() - start.getTime() + 1;
  return { start, end, prevStart: new Date(start.getTime() - span), prevEnd: new Date(start.getTime() - 1) };
}

export type Range = { start: Date; end: Date; prevStart: Date; prevEnd: Date };
function ranges(now: Date, custom?: CustomRange | null): Record<Exclude<Period, "custom">, Range> & { custom?: Range } {
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
    ...(custom && customWindow(custom) ? { custom: customWindow(custom)! } : {}),
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
    const e = m.get(s.clientId) ?? { id: s.clientId, name: s.client?.name ?? "—", gpsLat: s.client?.gpsLat ?? null, gpsLng: s.client?.gpsLng ?? null, revenue: 0, profit: 0, count: 0 };
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
  custom?: CustomRange | null;
}): DashboardData {
  const { now, sales, expenses, vans } = args;
  const R = ranges(now, args.custom);
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
      custom: { ...emptyAgg(), products: [], clients: [] },
    },
    trend: Array.from({ length: 14 }, () => ({ r: 0, p: 0 })),
  }));
  const vanIdx = new Map(vanBlocks.map((v, i) => [v.id, i]));

  // "custom" always exists (empty without a range) so every Record<Period,…> is total.
  periods.custom = { cur: emptyAgg(), prev: emptyAgg() };
  channels.custom = { DEPOT: 0, VAN: 0, POS: 0 };
  other.custom = emptyAgg();
  top.custom = { products: [], clients: [], vans: [] };
  const active: Period[] = R.custom ? [...PERIODS, "custom"] : PERIODS;
  for (const p of active) {
    const r = R[p]!;
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

  // With a custom window the company chart follows it (≤ 120 days, ending at
  // the window's last day or today, whichever is earlier).
  if (R.custom) {
    const last = startOfDay(R.custom.end > now ? now : R.custom.end);
    const first = startOfDay(R.custom.start);
    const n = Math.min(120, Math.max(1, Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1));
    const from = addDays(last, -(n - 1));
    const t2: DashboardData["trend"] = [];
    const idx2 = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i);
      idx2.set(dayKey(d), t2.length);
      t2.push({ date: dayKey(d), revenue: 0, profit: 0 });
    }
    for (const s of sales) {
      const ti = idx2.get(dayKey(s.date));
      if (ti === undefined || !inRange(s.date, R.custom.start, R.custom.end)) continue;
      const total = num(s.total);
      t2[ti].revenue += total;
      t2[ti].profit += total - saleCogs(s);
    }
    trend.length = 0;
    trend.push(...t2);
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

  const customRange = R.custom && args.custom
    ? { from: args.custom.from, to: args.custom.to, days: Math.round((R.custom.end.getTime() - R.custom.start.getTime()) / 86_400_000) }
    : null;
  return { nowIso: now.toISOString(), customRange, periods, trend, channels, top, vans: visibleVans, other, recent };
}
