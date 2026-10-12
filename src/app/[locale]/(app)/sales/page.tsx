import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listSeasons } from "@/lib/season/seasons";
import { KpiCard } from "@/components/ui/Card";
import { ReceiptText, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import { dzMoney } from "@/lib/format";
import { SalesClient } from "./SalesClient";
import { getSaleFormData } from "./saleRefs";

/// المبيعات = real sales only (DELIVERY / TICKET / INVOICE). A commande
/// (ORDER) is NOT a sale — it lives in الطلبات until the product is handed
/// over (→ BL) or the money is taken, which is what creates the sale.
const KINDS = ["DELIVERY", "INVOICE", "TICKET"] as const;

const fmt = (v: number) => dzMoney(v);

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
  const [rows, formData, dayAgg, seasonAgg] = await Promise.all([
    prisma.sale.findMany({
      where: {
        companyId: session.companyId,
        kind: kind ? (kind as never) : { in: ["DELIVERY", "TICKET", "INVOICE"] as never },
        date: { gte: rangeStart, lt: rangeEnd },
      },
      include: {
        client: { select: { name: true, code: true } },
        location: { select: { id: true, name: true, matricule: true, kind: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    getSaleFormData(session.companyId),
    prisma.sale.aggregate({
      where: { companyId: session.companyId, kind: { in: ["DELIVERY", "TICKET", "INVOICE"] }, date: { gte: dayStart } },
      _sum: { total: true, paid: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: {
        companyId: session.companyId,
        kind: { in: ["DELIVERY", "TICKET", "INVOICE"] },
        date: { gte: rangeStart, lt: rangeEnd },
      },
      _sum: { total: true, paid: true },
      _count: true,
    }),
  ]);
  const dayTotal = Number(dayAgg._sum.total ?? 0);
  const seasonTotal = Number(seasonAgg._sum.total ?? 0);
  const seasonCount = seasonAgg._count;
  return (
    <div className="flex flex-col space-y-4 p-5 md:p-6 lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden lg:pb-4">
      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard
          label={t("kpiToday")}
          value={fmt(dayTotal)}
          icon={<ShoppingCart size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact
        />
        <KpiCard
          label={t("kpiMonth")}
          value={fmt(seasonTotal)}
          icon={<TrendingUp size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
        <KpiCard
          label={t("kpiCount")}
          value={String(seasonCount)}
          icon={<ReceiptText size={18} />}
          accent="bg-violet-500/15 text-violet-500"
          compact
        />
        <KpiCard
          label={t("collected")}
          value={fmt(Number(seasonAgg._sum.paid ?? 0))}
          icon={<Wallet size={18} />}
          accent="bg-amber-500/15 text-amber-600"
          compact
        />
      </div>
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
      }}
      detailLabels={{
        client: t("client"), walkin: t("walkin"), total: t("total"), paid: t("paid"), due: t("due"),
        confirm: t("confirm"), deliver: t("deliver"), invoice: t("invoice"), cancel: t("cancel"),
        print: t("print"), location: t("location"), move: t("move"), moveTo: t("moveTo"),
        unitPriceL: t("unitPriceL"), packPriceL: t("packPriceL"), product: t("product"),
        qtyPack: t("qtyPack"), qtyPiece: t("qtyPiece"), assign: t("assign"), edit: t("edit"),
      }}
      />
    </div>
  );
}
