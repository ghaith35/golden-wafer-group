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
  const t = await getTranslations("superadmin");
  return (
    <SuperAdminShell
      locale={locale}
      username={session.username}
      labels={{
        dashboard: t("dashboard"),
        licenses: t("licenses"),
        companies: t("companies"),
        audit: t("audit"),
        tunnels: t("tunnels"),
        sectionOverview: t("sectionOverview"),
        sectionMgmt: t("sectionMgmt"),
        sectionSystem: t("sectionSystem"),
        header: t("header"),
        logout: t("logout"),
        collapse: t("collapse"),
        expand: t("expand"),
      }}
    >
      {children}
    </SuperAdminShell>
  );
}
