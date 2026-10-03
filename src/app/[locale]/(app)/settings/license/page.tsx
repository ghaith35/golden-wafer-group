import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LicenseConsole } from "../../license/LicenseConsole";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export default async function SettingsLicensePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/dashboard`);
  const t = await getTranslations("license");
  const tc = await getTranslations("common");
  const ts = await getTranslations("settings");
  return (
    <SettingsPanel title={ts("sections.license")} description={ts("sections.licenseDesc")}>
      <LicenseConsole
        labels={{
          title: t("console"), notConfigured: t("notConfigured"), shopLabel: t("shopLabel"),
          machine: t("machine"), pool: t("pool"), mint: t("mint"), revoke: t("revoke"),
          unrevoke: t("unrevoke"), reset: t("reset"), endTrial: t("endTrial"),
          machines: t("machines"), empty: t("empty"),
          search: tc("search"), save: tc("save"), cancel: tc("cancel"), delete: tc("delete"),
          deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        }}
      />
    </SettingsPanel>
  );
}
