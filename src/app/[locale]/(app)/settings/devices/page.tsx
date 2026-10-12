import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ensurePublicHostname } from "@/lib/sync/public-host";
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
  const vans = await prisma.store.findMany({
    where: { companyId: session.companyId, kind: "VAN", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const companySettings = await prisma.companySettings.findUnique({
    where: { companyId: session.companyId },
    select: { remoteDomain: true },
  });
  // Dynamic per-install link: wherever this EXE/DMG (or client stack) runs,
  // its hostname file/env self-sets remoteDomain — admin only sees the QR.
  const serverUrl = await ensurePublicHostname(session.companyId).catch(
    () => companySettings?.remoteDomain ?? ""
  );
  return (
    <SettingsPanel title={ts("sections.devices")} description={ts("sections.devicesDesc")}>
      <DevicesClient
        locale={locale}
        serverUrl={serverUrl}
        tunnelActive={process.env.DISTRIBUILI_TUNNEL === "1"}
        vans={vans}
        labels={{
          devices: t("devices"), label: t("label"), van: t("van"),
          lastSync: t("lastSync"), unbound: t("unbound"),
          search: tc("search"), edit: tc("edit"), save: tc("save"), cancel: tc("cancel"),
          empty: t("noDevice"), active: tc("active"), inactive: tc("inactive"),
          sharedQrTitle: t("sharedQrTitle"), sharedQrHint: t("sharedQrHint"),
          publicDomainMissing: t("publicDomainMissing"),
          linkInternet: t("linkInternet"), linkLanOnly: t("linkLanOnly"),
        }}
      />
    </SettingsPanel>
  );
}
