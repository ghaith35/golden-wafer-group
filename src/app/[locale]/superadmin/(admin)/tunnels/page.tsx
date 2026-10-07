import { setRequestLocale, getTranslations } from "next-intl/server";
import { TunnelsClient } from "./TunnelsClient";

export default async function SuperAdminTunnelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  return (
    <div>
      <h1 className="mb-3 text-xl font-black">{t("tunnels")}</h1>
      <TunnelsClient
        labels={{
          tunnelAllocate: t("tunnelAllocate"), tunnelLabel: t("tunnelLabel"),
          tunnelRevoke: t("tunnelRevoke"), tunnelEmpty: t("tunnelEmpty"),
          tunnelManual: t("tunnelManual"), tunnelToken: t("tunnelToken"),
          tunnelShow: t("tunnelShow"), tunnelHide: t("tunnelHide"),
        }}
      />
    </div>
  );
}
