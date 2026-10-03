import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { PosClient } from "./PosClient";

/// Depot counter POS: cashier picks location + tier per sale. Toggle-gated.
export default async function PosPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const settings = await getOrCreateSettings(session.companyId);
  if (!settings.posEnabled) redirect(`/${locale}/sales`);
  const t = await getTranslations("sales");
  const tc = await getTranslations("common");
  const [depots, products, categories, clients, tiers] = await Promise.all([
    prisma.store.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({
      where: { companyId: session.companyId, isActive: true },
      include: {
        baseUnit: true,
        conversions: { include: { unit: true } },
        tierPrices: true,
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.productCategory.findMany({ where: { companyId: session.companyId }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.priceTier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const firstDepot = depots.find((d) => d.kind === "DEPOT") ?? depots[0] ?? null;
  return (
    <PosClient
      locale={locale}
      depots={JSON.parse(JSON.stringify(depots))}
      presetDepotId={firstDepot?.id ?? ""}
      products={JSON.parse(JSON.stringify(products)).map(
        (p: { salePrice: unknown; stockQty: unknown; tierPrices: Array<{ price: unknown }> } & Record<string, unknown>) => ({
          ...p,
          salePrice: Number(p.salePrice),
          stockQty: Number(p.stockQty),
          tierPrices: p.tierPrices.map((x) => ({ ...x, price: Number(x.price) })),
        })
      )}
      categories={categories}
      clients={JSON.parse(JSON.stringify(clients)).map((c: { balance: unknown } & Record<string, unknown>) => ({ ...c, balance: Number(c.balance) }))}
      tiers={tiers}
      remiseEnabled={settings.remiseEnabled}
      creditEnabled={settings.creditSalesEnabled}
      allowPieces={settings.pieceSalesEnabled}
      labels={{
        title: t("pos"), search: tc("search"), total: t("total"), paid: t("paid"),
        remise: t("remise"), client: t("client"), walkin: t("walkin"), searchClient: t("searchClient"),
        balance: t("balance"), tier: t("tier"), depot: t("location"), qty: t("qty"),
        unit: t("unit"), price: t("price"), cashOnly: t("cashOnly"), notes: t("notes"),
        save: t("save"), empty: t("empty"), all: t("all"),
        newSale: t("newTicket"), exact: t("exact"), change: t("change"), due: t("due"),
        currency: settings.currency === "DZD" ? "DA" : settings.currency,
      }}
    />
  );
}
