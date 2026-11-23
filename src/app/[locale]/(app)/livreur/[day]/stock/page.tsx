import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { VanStockClient } from "./VanStockClient";

/// Livreur stock: held-for-commandes vs free-to-sell + depot availability.
export default async function LivreurStockPage({
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

  const imgRows = await prisma.productImage.findMany({
    where: { product: { companyId: session.companyId, isActive: true } },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
    select: { productId: true, url: true },
  });
  const images: Record<string, string[]> = {};
  for (const r of imgRows) (images[r.productId] ??= []).push(r.url);

  return (
    <VanStockClient
      images={images}
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      role={session.role}
      labels={{
        stock: t("stock"), stockDepot: t("stockDepot"), held: t("stockHeldLbl"), free: t("stockFreeLbl"), depotLbl: t("stockDepotLbl"), empty: t("empty"), total: t("total"),
      }}
    />
  );
}
