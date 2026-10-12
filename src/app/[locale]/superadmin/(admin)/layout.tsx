import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSuperAdminSession } from "@/lib/superadmin/session";
import { SuperAdminShell } from "../SuperAdminShell";

/// Guard: everything under (admin) requires a live vendor session.
/// The proxy already redirects strangers to /login; this is the second wall.
export default async function SuperAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSuperAdminSession();
  if (!session) redirect(`/${locale}/superadmin/login`);
  const t = await getTranslations({ locale: "en", namespace: "superadmin" });
  return (
    <SuperAdminShell
      locale={locale}
      username={session.username}
      labels={{
        dashboard: t("dashboard"),
        licenses: t("licenses"),
        deployments: t("deployments"),
        companies: t("companies"),
        sales: t("sales"),
        audit: t("audit"),
        tunnels: t("tunnels"),
        sectionOverview: t("sectionOverview"),
        sectionMgmt: t("sectionMgmt"),
        sectionSystem: t("sectionSystem"),
        header: t("header"),
        logout: t("logout"),
        collapse: t("collapse"),
        expand: t("expand"),
        accountSettings: t("accountSettings"),
        currentPassword: t("currentPassword"),
        newPassword: t("newPassword"),
        passwordOptional: t("passwordOptional"),
        save: t("save"),
        cancel: t("cancel"),
        current_password_required: t("currentPasswordRequired"),
        invalid_current_password: t("invalidCurrentPassword"),
        invalid_username: t("invalidUsername"),
        weak_password: t("weakPassword"),
        username_taken: t("usernameTaken"),
        no_changes: t("noChanges"),
      }}
    >
      {children}
    </SuperAdminShell>
  );
}
