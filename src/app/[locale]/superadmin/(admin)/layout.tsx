import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSuperAdminSession } from "@/lib/superadmin/session";
import { SuperAdminNav } from "../SuperAdminNav";

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
    <div className="mx-auto w-full max-w-5xl space-y-4 p-5 md:p-6">
      <SuperAdminNav
        locale={locale}
        username={session.username}
        labels={{
          dashboard: t("dashboard"), licenses: t("licenses"), companies: t("companies"),
          audit: t("audit"), logout: t("logout"),
        }}
      />
      {children}
    </div>
  );
}
