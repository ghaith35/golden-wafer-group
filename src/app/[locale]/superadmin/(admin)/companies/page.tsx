import { setRequestLocale, getTranslations } from "next-intl/server";
import { CompaniesClient } from "./CompaniesClient";

export default async function SuperAdminCompaniesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("common");
  return (
    <CompaniesClient
      labels={{
        title: t("companies"),
        countLine: t.raw("companiesCount"),
        search: tc("search"),
        empty: t("empty"),
        neW: t("neW"),
        colName: t("colName"),
        colUsers: t("colUsers"),
        colStores: t("colStores"),
        colCreated: t("colCreated"),
        newTitle: t("companyNew"),
        name: t("companyName"),
        phone: t("phone"),
        adminUser: t("adminUser"),
        adminName: t("adminName"),
        adminPass: t("adminPass"),
        save: tc("save"),
        cancel: tc("cancel"),
      }}
    />
  );
}
