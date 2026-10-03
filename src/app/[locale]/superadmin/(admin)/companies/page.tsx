import { setRequestLocale, getTranslations } from "next-intl/server";
import { CompaniesClient } from "./CompaniesClient";

export default async function SuperAdminCompaniesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("common");
  return (
    <div>
      <h1 className="mb-3 text-xl font-black">{t("companies")}</h1>
      <CompaniesClient
        labels={{
          search: tc("search"), empty: t("empty"), neW: t("neW"),
          newTitle: t("companyNew"), name: t("companyName"), phone: t("phone"),
          adminUser: t("adminUser"), adminName: t("adminName"), adminPass: t("adminPass"),
          users: t("users"), stores: t("stores"),
          save: tc("save"), cancel: tc("cancel"),
        }}
      />
    </div>
  );
}
