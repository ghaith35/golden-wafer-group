import { prisma } from "@/lib/db";

const TZ = "Africa/Algiers";

export type ClientStats = {
  /// Lifetime, this van's real invoices (cancelled / drafts never count).
  totalSold: number;
  invoiceCount: number;
  avgTicket: number;
  lastSaleAt: string | null;
  /// Month filter: "all" or "YYYY-MM" (Africa/Algiers). Everything below up to
  /// `recent` is scoped to it; `totalSold` / `invoiceCount` stay lifetime.
  selected: string;
  selectedLabel: string;
  selectedIsCurrent: boolean;
  monthSold: number;
  monthCount: number;
  /// Month before the selected one, for the trend chip (null = nothing to compare to / "all").
  prevMonthSold: number | null;
  /// Last 12 months, oldest first.
  months: Array<{ key: string; label: string; total: number; count: number; current: boolean }>;
  topProducts: Array<{ productId: string; name: string; qty: number; revenue: number }>;
  /// Free items (3pack) given to this client this month.
  offers: Array<{ name: string; qty: number }>;
  offersQty: number;
  recent: Array<{
    id: string;
    number: string;
    kind: string;
    date: string;
    total: number;
    paid: number;
    onHold: boolean;
  }>;
};

/// "2026-11" for a date, read in the business timezone (never the server's).
function ymKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d);
}

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/// Everything the van client view shows, computed from THIS van's own sales to
/// the client. Real invoices only: same rule as the van cash till.
export async function loadClientStats(
  companyId: string,
  locationId: string,
  clientId: string,
  locale: string,
  month?: string,
): Promise<ClientStats> {
  const saleWhere = {
    companyId,
    locationId,
    clientId,
    kind: { in: ["DELIVERY", "TICKET"] as ("DELIVERY" | "TICKET")[] },
    status: { notIn: ["CANCELLED", "DRAFT"] as ("CANCELLED" | "DRAFT")[] },
  };

  const now = new Date();
  const [cy, cm] = ymKey(now).split("-").map(Number);
  const first = shiftMonth(cy, cm, -11);
  // Algeria has no DST (UTC+1): the 1st at 00:00 local is 23:00 UTC the day before.
  const startOf = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1) - 3600_000);
  const windowStart = startOf(first.y, first.m);
  const curKey = `${cy}-${String(cm).padStart(2, "0")}`;

  // Month filter (default = current month; "all" = no date limit).
  const wanted = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : month === "all" ? "all" : curKey;
  let range: { gte: Date; lt: Date } | null = null;
  let selY = cy;
  let selM = cm;
  if (wanted !== "all") {
    [selY, selM] = wanted.split("-").map(Number);
    const nx = shiftMonth(selY, selM, 1);
    range = { gte: startOf(selY, selM), lt: startOf(nx.y, nx.m) };
  }
  const scopedWhere = range ? { ...saleWhere, date: range } : saleWhere;

  const [agg, scopedAgg, win, recent, byProduct, gifts] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { total: true }, _count: true, _max: { date: true } }),
    prisma.sale.aggregate({ where: scopedWhere, _sum: { total: true }, _count: true }),
    prisma.sale.findMany({
      where: { ...saleWhere, date: { gte: windowStart } },
      select: { date: true, total: true },
      take: 10000,
    }),
    prisma.sale.findMany({
      where: scopedWhere,
      orderBy: { date: "desc" },
      take: range ? 200 : 40,
      select: { id: true, number: true, kind: true, date: true, total: true, paid: true, confirmedAt: true },
    }),
    prisma.saleLine.groupBy({
      by: ["productId"],
      where: { isBonus: false, sale: scopedWhere },
      _sum: { baseQty: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 5,
    }),
    prisma.saleLine.groupBy({
      by: ["productId"],
      where: { isBonus: true, sale: scopedWhere },
      _sum: { baseQty: true },
    }),
  ]);

  const names = new Map(
    (
      await prisma.product.findMany({
        where: { id: { in: [...new Set([...byProduct, ...gifts].map((r) => r.productId))] } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );

  // Monthly buckets (oldest → newest).
  const buckets = new Map<string, { total: number; count: number }>();
  const months = Array.from({ length: 12 }, (_, i) => {
    const { y, m } = shiftMonth(first.y, first.m, i);
    const key = `${y}-${String(m).padStart(2, "0")}`;
    buckets.set(key, { total: 0, count: 0 });
    const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(`${locale}-u-nu-latn`, { month: "short", timeZone: "UTC" });
    return { key, label, total: 0, count: 0, current: key === wanted };
  });
  for (const s of win) {
    const b = buckets.get(ymKey(s.date));
    if (b) {
      b.total += Number(s.total);
      b.count += 1;
    }
  }
  for (const m of months) {
    m.total = buckets.get(m.key)?.total ?? 0;
    m.count = buckets.get(m.key)?.count ?? 0;
  }
  const pk = wanted === "all" ? null : shiftMonth(selY, selM, -1);
  const prevKey = pk ? `${pk.y}-${String(pk.m).padStart(2, "0")}` : null;
  const prevB = prevKey ? buckets.get(prevKey) : null;
  const prevMonthSold = prevB && prevB.count > 0 ? prevB.total : null;
  const selectedLabel =
    wanted === "all"
      ? ""
      : new Date(Date.UTC(selY, selM - 1, 15)).toLocaleDateString(`${locale}-u-nu-latn`, { month: "long", year: "numeric", timeZone: "UTC" });

  const totalSold = Number(agg._sum.total ?? 0);
  const invoiceCount = agg._count;
  const offers = gifts
    .map((g) => ({ name: names.get(g.productId) ?? "—", qty: Number(g._sum.baseQty ?? 0) }))
    .filter((g) => g.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  return {
    totalSold,
    invoiceCount,
    avgTicket: invoiceCount ? totalSold / invoiceCount : 0,
    lastSaleAt: agg._max.date ? agg._max.date.toISOString() : null,
    selected: wanted,
    selectedLabel,
    selectedIsCurrent: wanted === curKey,
    monthSold: Number(scopedAgg._sum.total ?? 0),
    monthCount: scopedAgg._count,
    prevMonthSold,
    months,
    topProducts: byProduct.map((r) => ({
      productId: r.productId,
      name: names.get(r.productId) ?? "—",
      qty: Number(r._sum.baseQty ?? 0),
      revenue: Number(r._sum.lineTotal ?? 0),
    })),
    offers,
    offersQty: offers.reduce((n, o) => n + o.qty, 0),
    recent: recent.map((s) => ({
      id: s.id,
      number: s.number,
      kind: s.kind,
      date: s.date.toISOString(),
      total: Number(s.total),
      paid: Number(s.paid),
      onHold: s.kind === "TICKET" && !s.confirmedAt,
    })),
  };
}
