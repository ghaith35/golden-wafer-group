import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { UsersClient } from "../../users/UsersClient";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

/// Settings → Admins: the only place where Admin accounts are created,
/// modified or deleted. The standalone Livreur / Pré-vendeur page manages
/// staff accounts exclusively.
export default async function SettingsAdminsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/dashboard`);
  const t = await getTranslations("users");
  const tc = await getTranslations("common");
  const ts = await getTranslations("settings");
  const vans = await prisma.store.findMany({
    where: { companyId: session.companyId, kind: "VAN", isActive: true },
    orderBy: { name: "asc" },
  });
  return (
    <SettingsPanel title={ts("sections.admins")} description={ts("sections.adminsDesc")}>
      <UsersClient
        locale={locale}
        vans={vans}
        allowedRoles={["Admin"]}
        scope="admins"
        labels={{
          title: t("admins"), username: t("username"), password: t("password"),
          fullName: t("fullName"), van: t("van"), add: tc("add"), empty: t("empty"),
          search: tc("search"), edit: tc("edit"), delete: tc("delete"),
          deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
          save: tc("save"), cancel: tc("cancel"), active: tc("active"),
          inactive: tc("inactive"), qrCode: t("qrCode"), qrRegenerate: t("qrRegenerate"),
          showPw: t("showPw"), hidePw: t("hidePw"),
          emptyTitle: t("emptyTitle"), emptyHint: t("emptyHint"), emptyHintAdmins: t("emptyHintAdmins"),
          roleVendeur: t("roleVendeur"), roleLivreur: t("roleLivreur"), roleAdmin: t("roleAdmin"),
          firstAdd: t("firstAdd"), goAdmins: t("goAdmins"), goHref: `/${locale}/users`,
          all: t("all"),
        }}
      />
    </SettingsPanel>
  );
}
