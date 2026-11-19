import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listSeasons } from "@/lib/season/seasons";
import { SalesClient } from "./SalesClient";
import { getSaleFormData } from "./saleRefs";

/// المبيعات = real sales only (DELIVERY / TICKET / INVOICE). A commande
/// (ORDER) is NOT a sale — it lives in الطلبات until the product is handed
/// over (→ BL) or the money is taken, which is what creates the sale.
const KINDS = ["DELIVERY", "INVOICE", "TICKET"] as const;

export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; year?: string; month?: string; day?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  // Mandob (Vendeur): no sale creation, no factures — proxy enforces too.
  if (session.role === "Vendeur") redirect(`/${locale}/dashboard`);
  const t = await getTranslations("sales");
  const tp = await getTranslations("purchases");
  const tc = await getTranslations("common");
  const now = new Date();
  const kind = KINDS.includes((sp.kind ?? "") as never) ? (sp.kind as string) : "";
  const seasons = await listSeasons(session.companyId);
  const years = [...new Set(seasons.map((s) => s.year))].sort((a, b) => b - a);
  const year = Number(sp.year) || now.getFullYear();
  const months = seasons.filter((s) => s.year === year).map((s) => s.month);
  if (!months.includes(now.getMonth() + 1)) months.push(now.getMonth() + 1);
  months.sort((a, b) => b - a);
  const month = months.includes(Number(sp.month)) ? Number(sp.month) : now.getMonth() + 1;
  const dim = new Date(year, month, 0).getDate();
  const day = Number(sp.day) >= 1 && Number(sp.day) <= dim ? Number(sp.day) : 0;
  const rangeStart = day ? new Date(year, month - 1, day) : new Date(year, month - 1, 1);
  const rangeEnd = day ? new Date(year, month - 1, day + 1) : new Date(year, month, 1);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const yStart = new Date(dayStart.getTime() - 86400000);
  const yNow = new Date(now.getTime() - 86400000);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const prevStart = new Date(year, month - 2, 1);
  // Same elapsed span for the running month, whole month for a past one.
  const elapsed = Math.min(now.getTime(), monthEnd.getTime()) - monthStart.getTime();
  const prevEnd = new Date(Math.min(prevStart.getTime() + elapsed, monthStart.getTime()));
  const real = { in: ["DELIVERY", "TICKET", "INVOICE"] as never };
  const live = { not: "CANCELLED" as never };
  const base = { companyId: session.companyId, kind: real, status: live };
  const [rows, formData, monthRows, todayAgg, yAgg, prevAgg] = await Promise.all([
    prisma.sale.findMany({
      where: {
        companyId: session.companyId,
        kind: kind ? (kind as never) : real,
        date: { gte: rangeStart, lt: rangeEnd },
      },
      include: {
        client: { select: { name: true, code: true } },
        location: { select: { id: true, name: true, matricule: true, kind: true } },
      },
      orderBy: { date: "desc" },
      take: 600,
    }),
    getSaleFormData(session.companyId),
    prisma.sale.findMany({
      where: { ...base, date: { gte: monthStart, lt: monthEnd } },
      select: { date: true, total: true, paid: true, locationId: true },
      take: 60000,
    }),
    prisma.sale.aggregate({ where: { ...base, date: { gte: dayStart } }, _sum: { total: true }, _count: true }),
    prisma.sale.aggregate({ where: { ...base, date: { gte: yStart, lte: yNow } }, _sum: { total: true } }),
    prisma.sale.aggregate({ where: { ...base, date: { gte: prevStart, lt: prevEnd } }, _sum: { total: true } }),
  ]);

  // Month analytics: daily series (drives the day strip + sparkline) and
  // per-van totals for the selected range (a day or the whole month).
  const series = Array.from({ length: dim }, () => 0);
  const dayCount = Array.from({ length: dim }, () => 0);
  const byVan: Record<string, { count: number; total: number }> = {};
  let rTotal = 0, rPaid = 0, rCount = 0;
  for (const r of monthRows) {
    const d = r.date.getDate() - 1;
    const t = Number(r.total);
    series[d] += t;
    dayCount[d] += 1;
    if (day && r.date.getDate() !== day) continue;
    rTotal += t;
    rPaid += Number(r.paid ?? 0);
    rCount += 1;
    if (r.locationId) {
      const e = byVan[r.locationId] ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += t;
      byVan[r.locationId] = e;
    }
  }
  const stats = {
    nowIso: now.toISOString(),
    today: { total: Number(todayAgg._sum.total ?? 0), count: todayAgg._count, prev: Number(yAgg._sum.total ?? 0) },
    range: {
      total: rTotal,
      paid: rPaid,
      count: rCount,
      // Day view compares with the previous day of the series; month view with last month.
      prev: day ? (day > 1 ? series[day - 2] : 0) : Number(prevAgg._sum.total ?? 0),
    },
    series,
    dayCount,
    byVan,
  };
  return (
    <div className="flex flex-col space-y-3 p-4 sm:p-5 md:p-6 lg:h-[calc(var(--vh)-3.5rem)] lg:overflow-hidden lg:pb-4">
      <SalesClient
      locale={locale}
      kind={kind}
      year={year}
      month={month}
      day={day}
      days={dim}
      years={years.length ? years : [now.getFullYear()]}
      months={months}
      rows={JSON.parse(JSON.stringify(rows))}
      stats={stats}
      formData={formData}
      formLabels={{
        client: t("client"), searchClient: t("searchClient"), required: t("required"), walkin: t("walkin"),
        tier: t("tier"), balance: t("balance"), location: t("location"), qrScanned: t("qrScanned"),
        product: tp("product"), unit: t("unit"), qty: t("qty"), price: t("price"), lineTotal: t("lineTotal"),
        addLine: tp("addLine"), remise: t("remise"), paid: t("paid"), cashOnly: t("cashOnly"),
        total: t("total"), notes: t("notes"), save: t("save"), offlineMode: t("offlineMode"), depotStock: t("depotStock"),
      }}
      labels={{
        title: t("title"), pos: t("pos"), returns: t("returns"),
        newTicket: t("newTicket"), newOrder: t("newOrder"),
        orders: t("orders"), deliveries: t("deliveries"), invoices: t("invoices"), tickets: t("tickets"),
        empty: t("empty"), walkin: t("walkin"), offList: t("offList"), due: t("due"),
        search: tc("search"), allVans: t("allVans"), paid: t("paid"), kpiAvg: t("kpiAvg"),
        total: t("total"), all: t("all"), kpiCount: t("kpiCount"), unsynced: t("unsynced"),
        kpiToday: t("kpiToday"), kpiMonth: t("kpiMonth"), collected: t("collected"),
        vsYesterday: t("vsYesterday"), vsPrevMonth: t("vsPrevMonth"), vsPrevDay: t("vsPrevDay"),
        kpiOutstanding: t("kpiOutstanding"), ofTotal: t("ofTotal"),
        payAll: t("payAll"), paySettled: t("paySettled"), payDue: t("payDue"),
        back: t("back"), selectInvoice: t("selectInvoice"), today: t("today"), yesterday: t("yesterday"),
        year: t("year"), month: t("month"),
        kindTicket: t("kindTicket"), kindDelivery: t("kindDelivery"), kindInvoice: t("kindInvoice"),
        searchSales: t("searchSales"), noMatch: t("noMatch"), clearFilters: t("clearFilters"),
        dayTotal: t("dayTotal"), invoicesWord: t("invoicesWord"), avgShort: t("avgShort"),
        draft: t("draft"), confirmed: t("confirmed"), delivered: t("delivered"), invoiced: t("invoiced"), cancelled: t("cancelled"),
      }}
      detailLabels={{
        client: t("client"), walkin: t("walkin"), total: t("total"), paid: t("paid"), due: t("due"),
        confirm: t("confirm"), deliver: t("deliver"), invoice: t("invoice"), cancel: t("cancel"),
        print: t("print"), location: t("location"), move: t("move"), moveTo: t("moveTo"),
        unitPriceL: t("unitPriceL"), packPriceL: t("packPriceL"), product: t("product"),
        qtyPack: t("qtyPack"), qtyPiece: t("qtyPiece"), assign: t("assign"), edit: t("edit"),
        draft: t("draft"), confirmed: t("confirmed"), delivered: t("delivered"), invoiced: t("invoiced"), cancelled: t("cancelled"),
        kindTicket: t("kindTicket"), kindDelivery: t("kindDelivery"), kindInvoice: t("kindInvoice"), kindOrder: t("kindOrder"),
        linesCount: t("linesCount"), pieces: t("pieces"), dateLabel: t("dateLabel"), progressPaid: t("progressPaid"),
        subtotal: t("subtotal"), discount: t("discount"), back: t("back"),
        printOrder: t("printOrder"), factureBtn: t("factureBtn"), bonLivraison: t("bonLivraison"), bonLivraisonDesc: t("bonLivraisonDesc"), bonRoute: t("bonRoute"), bonRouteDesc: t("bonRouteDesc"), soon: t("soon"),
      }}
      />
    </div>
  );
}
