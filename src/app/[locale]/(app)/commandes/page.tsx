import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listSeasons } from "@/lib/season/seasons";
import { CommandesClient } from "./CommandesClient";
import { getSaleFormData } from "../sales/saleRefs";

export default async function CommandesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("commandes");
  const ts = await getTranslations("sales");
  const tp = await getTranslations("purchases");
  const now = new Date();
  const seasons = await listSeasons(session.companyId);
  const years = [...new Set(seasons.map((s) => s.year))].sort((a, b) => b - a);
  const year = Number(sp.year) || now.getFullYear();
  const months = seasons.filter((s) => s.year === year).map((s) => s.month);
  if (!months.includes(now.getMonth() + 1)) months.push(now.getMonth() + 1);
  months.sort((a, b) => b - a);
  const month = months.includes(Number(sp.month)) ? Number(sp.month) : now.getMonth() + 1;
  const rangeStart = new Date(year, month - 1, 1);
  const rangeEnd = new Date(year, month, 1);
  const [rows, formData] = await Promise.all([
    prisma.sale.findMany({
      where: { companyId: session.companyId, kind: "ORDER", date: { gte: rangeStart, lt: rangeEnd } },
      include: {
        client: { select: { name: true, code: true, gpsLat: true, gpsLng: true } },
        location: { select: { id: true, name: true, kind: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    getSaleFormData(session.companyId),
  ]);
  return (
    <div className="flex flex-col p-5 md:p-6 lg:h-[calc(var(--vh)-3.5rem)] lg:overflow-hidden lg:pb-4">
    <CommandesClient
      locale={locale}
      year={year}
      month={month}
      years={years.length ? years : [now.getFullYear()]}
      months={months}
      rows={JSON.parse(JSON.stringify(rows))}
      formData={formData}
      formLabels={{
        client: ts("client"), searchClient: ts("searchClient"), required: ts("required"), walkin: ts("walkin"),
        tier: ts("tier"), balance: ts("balance"), location: ts("location"), qrScanned: ts("qrScanned"),
        product: tp("product"), unit: ts("unit"), qty: ts("qty"), price: ts("price"), lineTotal: ts("lineTotal"),
        addLine: tp("addLine"), remise: ts("remise"), paid: ts("paid"), cashOnly: ts("cashOnly"),
        total: ts("total"), notes: ts("notes"), save: ts("save"), offlineMode: ts("offlineMode"), depotStock: ts("depotStock"),
      }}
      labels={{
        title: t("title"), new: t("new"), pending: t("pending"), confirmed: t("confirmed"),
        search: t("search"), all: t("all"), allVans: t("allVans"), confirm: t("confirm"),
        view: t("view"), empty: t("empty"), lines: t("lines"), stockShort: t("stockShort"), total: t("total"),
        stDraft: ts("draft"), stConfirmed: ts("confirmed"), stDelivered: ts("delivered"),
        unsynced: ts("unsynced"),
      }}
      detailLabels={{
        client: ts("client"), walkin: ts("walkin"), total: ts("total"), paid: ts("paid"), due: ts("due"),
        confirm: ts("confirm"), deliver: ts("deliver"), invoice: ts("invoice"), cancel: ts("cancel"),
        print: ts("print"), location: ts("location"), move: ts("move"), moveTo: ts("moveTo"),
        unitPriceL: ts("unitPriceL"), packPriceL: ts("packPriceL"), product: ts("product"),
        qtyPack: ts("qtyPack"), qtyPiece: ts("qtyPiece"), assign: ts("assign"), edit: ts("edit"),
        confirmOrderT: ts("confirmOrderT"), confirmOrderM: ts("confirmOrderM"),
        invoiceT: ts("invoiceT"), invoiceM: ts("invoiceM"),
        assignT: ts("assignT"), deleteOrderT: ts("deleteOrderT"), deleteOrderM: ts("deleteOrderM"), deliverT: ts("deliverT"), van: ts("van"),
        confirmLoad: ts("confirmLoad"), confirmLoadT: ts("confirmLoadT"), confirmLoadM: ts("confirmLoadM"),
        printOrder: ts("printOrder"),
      }}
    />
    </div>
  );
}
