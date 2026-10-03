import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DevicesClient } from "../../devices/DevicesClient";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export default async function SettingsDevicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/dashboard`);
  const t = await getTranslations("sync");
  const tc = await getTranslations("common");
  const ts = await getTranslations("settings");
  const [vans, users] = await Promise.all([
    prisma.store.findMany({
      where: { companyId: session.companyId, kind: "VAN", isActive: true },
      select: { id: true, name: true, userId: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { fullName: "asc" } }),
  ]);
  return (
    <SettingsPanel title={ts("sections.devices")} description={ts("sections.devicesDesc")}>
      <DevicesClient
        locale={locale}
        vans={vans}
        users={users}
        labels={{
          devices: t("devices"), tokenOnce: t("tokenOnce"), label: t("label"), van: t("van"),
          user: t("user"), newDevice: t("newDevice"), lastSync: t("lastSync"), unbound: t("unbound"),
          search: tc("search"), edit: tc("edit"), save: tc("save"), cancel: tc("cancel"),
          empty: t("noDevice"), active: tc("active"), inactive: tc("inactive"),
          setupQr: t("setupQr"), setupQrHint: t("setupQrHint"), syncUrl: t("syncUrl"),
        }}
      />
    </SettingsPanel>
  );
}
