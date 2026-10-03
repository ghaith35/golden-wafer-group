import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay, sameDay } from "../../_days";
import { CommandeClient } from "./CommandeClient";

/// Livreur "طلب جديد" — request-only flow: scan → products → recap → send.
/// Lands as a DRAFT order for the admin to confirm (no prices, no payment).
export default async function LivreurCommandePage({
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

  const [client, products, categories, nullStock, locatedStock, settings, tournees] = await Promise.all([
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
      where: { companyId: session.companyId, storeId: null, transferId: null },
      _sum: { qty: true },
    }),
    prisma.stockBatch.groupBy({
      by: ["productId"],
      where: { companyId: session.companyId, transferId: null, location: { kind: "DEPOT" } },
      _sum: { qty: true },
    }),
    prisma.companySettings.findUnique({
      where: { companyId: session.companyId },
      select: { pieceSalesEnabled: true },
    }),
    prisma.tournee.findMany({
      where: { companyId: session.companyId, locationId: van.id, status: "OPEN" },
      select: { id: true, date: true },
    }),
  ]);

  const tour = tournees.find((x) => sameDay(new Date(x.date), date)) ?? null;
  // Main-depot availability (null store = legacy main stock + DEPOT stores).
  const stockMap: Record<string, number> = {};
  for (const b of [...nullStock, ...locatedStock]) {
    stockMap[b.productId] = (stockMap[b.productId] ?? 0) + Number(b._sum.qty ?? 0);
  }

  return (
    <CommandeClient
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      tourneeId={tour?.id ?? null}
      initialClient={client ? JSON.parse(JSON.stringify(client)) : null}
      products={JSON.parse(JSON.stringify(products))}
      categories={JSON.parse(JSON.stringify(categories))}
      depotStock={stockMap}
      allowPieces={settings?.pieceSalesEnabled ?? false}
      labels={{
        scanTitle: t("scanTitle"), scanHint: t("scanHint"), scan: t("scan"),
        gallery: t("gallery"), qrNotFound: t("qrNotFound"), backToDash: t("backToDash"),
        products: t("products"), searchProduct: t("searchProduct"), allCats: t("allCats"),
        qty: t("qty"), colis: t("colis"), confirm: t("confirm"), cancel: t("cancel"),
        total: t("total"), stock: t("stock"), empty: t("empty"), saved: t("saved"),
        clients: t("clients"), backToProducts: t("backToProducts"),
        request: t("request"), sendRequest: t("sendRequest"),
        orderSaved: t("orderSaved"), orderQueued: t("orderQueued"),
        notes: t("notes"), commandes: t("commandes"),
        camNeedHttps: t("camNeedHttps"), camDenied: t("camDenied"), camUnsupported: t("camUnsupported"),
      }}
    />
  );
}
