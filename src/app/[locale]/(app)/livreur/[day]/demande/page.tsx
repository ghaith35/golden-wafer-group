import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { DemandeClient } from "./DemandeClient";

/// Livreur restock request (demande produits): like the order flow but for
/// the VAN, not a client. The driver picks products against DEPOT stock;
/// each send queues a depot→van `transfer-declare` (fully offline). His
/// requests list merges synced DECLARED transfers + queued ones, with
/// modify (rewrite) and delete. Admin validates in vans/orders — validation
/// confirms immediately, no van-side confirmation step.
export default async function LivreurDemandePage({
  params,
}: {
  params: Promise<{ locale: string; day: string }>;
}) {
  const { locale, day } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!parseDay(day)) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const [products, categories, depots, batches, transfers, settings] = await Promise.all([
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
    prisma.store.findMany({
      where: { companyId: session.companyId, kind: "DEPOT", isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.stockBatch.groupBy({
      by: ["productId", "storeId"],
      where: { companyId: session.companyId, transferId: null },
      _sum: { qty: true },
    }),
    prisma.transfer.findMany({
      where: { companyId: session.companyId, toLocationId: van.id },
      include: {
        fromLocation: { select: { name: true } },
        lines: { include: { product: { select: { id: true, name: true, baseUnitId: true, baseUnit: { select: { id: true, name: true } }, conversions: { select: { unitId: true, factor: true, unit: { select: { name: true } } } } } } } },
      },
      orderBy: { date: "desc" },
      take: 30,
    }),
    prisma.companySettings.findUnique({
      where: { companyId: session.companyId },
      select: { pieceSalesEnabled: true },
    }),
  ]);

  const depotStocks: Record<string, Record<string, number>> = {};
  for (const b of batches) {
    if (!b.storeId) continue;
    (depotStocks[b.storeId] ??= {})[b.productId] = Number(b._sum.qty ?? 0);
  }

  return (
    <DemandeClient
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      products={JSON.parse(JSON.stringify(products))}
      categories={JSON.parse(JSON.stringify(categories))}
      depots={JSON.parse(JSON.stringify(depots))}
      depotStocks={depotStocks}
      initialRequests={JSON.parse(JSON.stringify(transfers))}
      allowPieces={settings?.pieceSalesEnabled ?? false}
      labels={{
        restock: t("restock"), restockHint: t("restockHint"), myRequests: t("myRequests"),
        modify: t("modify"), depot: t("depot"),
        searchProduct: t("searchProduct"), allCats: t("allCats"),
        qty: t("qty"), colis: t("colis"), confirm: t("confirm"), cancel: t("cancel"),
        total: t("total"), stock: t("stock"), empty: t("empty"),
        notes: t("notes"), queuedOk: t("queuedOk"), offline: t("offline"),
        errSaveFailed: t("errSaveFailed"), syncFirst: t("syncFirst"),
        stockDepot: t("stockDepot"), remove: t("remove"),
        backToDash: t("backToDash"),
      }}
    />
  );
}
