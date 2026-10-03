import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
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

  return (
    <VanStockClient
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      labels={{
        stock: t("stock"), empty: t("empty"), total: t("total"),
      }}
    />
  );
}
