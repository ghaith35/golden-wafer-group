import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay, sameDay } from "../../_days";
import { VenteClient } from "./VenteClient";

/// Step 4 — Vente page: scan popup → products → facture → confirm → print.
export default async function LivreurVentePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; day: string }>;
  searchParams: Promise<{ client?: string }>;
}) {
  const { locale, day } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const date = parseDay(day);
  if (!date) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const [client, products, categories, vanStock, settings, tournees] = await Promise.all([
    sp.client
      ? prisma.customer.findFirst({
          where: { id: sp.client, companyId: session.companyId },
          select: { id: true, name: true, code: true, phone: true, tierId: true, balance: true },
        })
      : null,
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      include: {
        images: { orderBy: { sortOrder: "asc" } },
        tierPrices: true,
        conversions: { include: { unit: true } },
        baseUnit: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.productCategory.findMany({
      where: { companyId: session.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId: session.companyId, storeId: van.id, transferId: null },
      _sum: { qty: true },
    }),
    prisma.companySettings.findUnique({
      where: { companyId: session.companyId },
      select: { pieceSalesEnabled: true, ticketLang: true },
    }),
    prisma.tournee.findMany({
      where: { companyId: session.companyId, locationId: van.id, status: "OPEN" },
      select: { id: true, date: true },
    }),
  ]);

  const tour = tournees.find((x) => sameDay(new Date(x.date), date)) ?? null;
  const stockMap: Record<string, number> = {};
  for (const b of vanStock) stockMap[b.productId] = Number(b._sum.qty ?? 0);
  // Ticket labels follow the admin ticket language (default French),
  // not the UI locale the livreur browses in.
  const ticketLang = settings?.ticketLang === "ar" ? "ar" : "fr";
  const tt = await getTranslations({ locale: ticketLang, namespace: "sales" });

  return (
    <VenteClient
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      tourneeId={tour?.id ?? null}
      initialClient={client ? JSON.parse(JSON.stringify(client)) : null}
      products={JSON.parse(JSON.stringify(products))}
      categories={JSON.parse(JSON.stringify(categories))}
      vanStock={stockMap}
      allowPieces={settings?.pieceSalesEnabled ?? false}
      labels={{
        scanTitle: t("scanTitle"), scanHint: t("scanHint"), skip: t("skip"),
        chooseClient: t("chooseClient"), searchClient: t("searchClient"),
        products: t("products"), searchProduct: t("searchProduct"), allCats: t("allCats"),
        qty: t("qty"), colis: t("colis"), confirm: t("confirm"), cancel: t("cancel"),
        facture: t("facture"), total: t("total"), paid: t("paid"), print: t("print"),
        printTitle: t("printTitle"), printHint: t("printHint"), backToProducts: t("backToProducts"),
        empty: t("empty"), saved: t("saved"), stock: t("stock"), clients: t("clients"),
        gallery: t("gallery"), qrNotFound: t("qrNotFound"),
        backToDash: t("backToDash"), scan: t("scan"), camNeedHttps: t("camNeedHttps"),
        camDenied: t("camDenied"), camUnsupported: t("camUnsupported"), held: t("held"),
        ticketQueued: t("ticketQueued"),
      }}
      ticketLabels={{
        total: tt("total"), paid: tt("paid"), due: tt("due"), remise: tt("remise"),
        thanks: tt("thanks"), seller: tt("seller"), client: tt("client"), share: tt("share"),
        packs: tt("packs"), articles: tt("articles"), oldDebt: tt("oldDebt"), newDebt: tt("newDebt"),
        design: tt("product"), qty: tt("qty"), price: tt("price"), unitPrice: tt("unitPrice"),
      }}
      ticketLang={ticketLang}
    />
  );
}
