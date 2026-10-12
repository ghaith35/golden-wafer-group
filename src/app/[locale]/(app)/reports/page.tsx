import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ReportsClient } from "./ReportsClient";

/// Admin sales-by-van (proxy enforces admin-only).
export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("reports");
  return (
    <ReportsClient
      labels={{
        title: t("title"),
        empty: t("empty"),
        sales: t("sales"),
        profit: t("profit"),
        expenses: t("expenses"),
        hours: `${t("hours")} (${t("days")})`,
        products: t("products"),
        product: t("product"),
        qty: t("qty"),
        topProduct: t("topProduct"),
        selectVan: t("selectVan"),
      }}
    />
  );
}
