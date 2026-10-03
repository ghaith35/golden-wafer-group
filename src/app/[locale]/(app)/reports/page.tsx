import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ReportsClient } from "./ReportsClient";

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
        "debts-clients": t("debtsClients"),
        "debts-suppliers": t("debtsSuppliers"),
        margins: t("margins"),
        vans: t("vans"),
        export: t("export"),
        empty: t("empty"),
      }}
    />
  );
}
