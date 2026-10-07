import { setRequestLocale, getTranslations } from "next-intl/server";
import { CompanyDetailClient } from "./CompanyDetailClient";

export default async function SuperAdminCompanyPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("common");
  return (
    <CompanyDetailClient
      id={id}
      labels={{
        title: t("companyDetails"), edit: t("editCompany"), name: t("companyName"), phone: t("phone"),
        address: t("address"), email: t("email"), users: t("colUsers"), stores: t("colStores"),
        products: t("products"), save: tc("save"), cancel: tc("cancel"), retry: t("retry"),
        loading: t("loading"), notFound: t("empty"),
        staff: t("staff"), locations: t("locations"), addUser: t("addUser"), addLocation: t("addLocation"),
        editUser: t("editUser"), editLocation: t("editLocation"), username: t("username"), fullName: t("fullName"),
        password: t("password"), newPasswordOptional: t("newPasswordOptional"), role: t("role"),
        enable: t("enable"), disable: t("disable"), noStaff: t("noStaff"), noLocations: t("noLocations"),
        kind: t("kind"), depot: t("depot"), van: t("van"), brand: t("brand"), registration: t("registration"),
        invalid_user: t("invalidUser"), duplicate_username: t("duplicateUsername"), weak_password: t("weakPassword"),
        invalid_role: t("invalidRole"),
      }}
    />
  );
}