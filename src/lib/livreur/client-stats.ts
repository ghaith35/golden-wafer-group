import { prisma } from "@/lib/db";

const TZ = "Africa/Algiers";

export type ClientStats = {
  /// Lifetime, this van's real invoices (cancelled / drafts never count).
  totalSold: number;
  invoiceCount: number;
  avgTicket: number;
  lastSaleAt: string | null;
  /// Current calendar month (Africa/Algiers).
  monthSold: number;
  monthCount: number;
  /// Previous month total, for the trend chip (null = nothing to compare to).
  prevMonthSold: number | null;
  /// Last 6 months, oldest first.
  months: Array<{ key: string; label: string; total: number; current: boolean }>;
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
  const first = shiftMonth(cy, cm, -5);
  // Algeria has no DST (UTC+1): the 1st at 00:00 local is 23:00 UTC the day before.
  const windowStart = new Date(Date.UTC(first.y, first.m - 1, 1) - 3600_000);
  const monthStart = new Date(Date.UTC(cy, cm - 1, 1) - 3600_000);

  const [agg, win, recent, byProduct, gifts] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { total: true }, _count: true, _max: { date: true } }),
    prisma.sale.findMany({
      where: { ...saleWhere, date: { gte: windowStart } },
      select: { date: true, total: true },
      take: 5000,
    }),
    prisma.sale.findMany({
      where: saleWhere,
      orderBy: { date: "desc" },
      take: 40,
      select: { id: true, number: true, kind: true, date: true, total: true, paid: true, confirmedAt: true },
    }),
    prisma.saleLine.groupBy({
      by: ["productId"],
      where: { isBonus: false, sale: saleWhere },
      _sum: { baseQty: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 5,
    }),
    prisma.saleLine.groupBy({
      by: ["productId"],
      where: { isBonus: true, sale: { ...saleWhere, date: { gte: monthStart } } },
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
  const months = Array.from({ length: 6 }, (_, i) => {
    const { y, m } = shiftMonth(first.y, first.m, i);
    const key = `${y}-${String(m).padStart(2, "0")}`;
    buckets.set(key, { total: 0, count: 0 });
    const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(`${locale}-u-nu-latn`, { month: "short", timeZone: "UTC" });
    return { key, label, total: 0, current: i === 5 };
  });
  for (const s of win) {
    const b = buckets.get(ymKey(s.date));
    if (b) {
      b.total += Number(s.total);
      b.count += 1;
    }
  }
  for (const m of months) m.total = buckets.get(m.key)?.total ?? 0;
  const prev = months[4];
  const prevHasSales = (buckets.get(prev.key)?.count ?? 0) > 0;

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
    monthSold: months[5].total,
    monthCount: buckets.get(months[5].key)?.count ?? 0,
    prevMonthSold: prevHasSales ? prev.total : null,
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
