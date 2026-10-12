import { setRequestLocale, getTranslations } from "next-intl/server";
import { LicensesClient } from "./LicensesClient";

export default async function SuperAdminLicensesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale: "en", namespace: "superadmin" });
  const tc = await getTranslations({ locale: "en", namespace: "common" });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-(--text-primary)">{t("licenses")}</h1>
        <p className="mt-0.5 text-sm text-(--text-secondary)">{t("licensesSubtitle")}</p>
      </div>
      <LicensesClient
        labels={{
          tab_machines: t("tabMachines"), tab_keys: t("tabKeys"), tab_ips: t("tabIps"),
          search: tc("search"), all: t("all"), empty: t("empty"),
          st_pending: t("stPending"), st_activated: t("stActivated"), st_revoked: t("stRevoked"),
          trial: t("trial"), expired: t("expired"), free: t("free"),
          activate: t("activate"), unrevoke: t("unrevoke"), revoke: t("revoke"),
          revokeTitle: t("revokeTitle"), revokeMsg: t("revokeMsg"),
          endTrial: t("endTrial"), edit: tc("edit"), reset: t("reset"),
          resetTitle: t("resetTitle"), resetMsg: t("resetMsg"),
          delete: tc("delete"), deleteTitle: t("deleteTitle"), deleteMsg: t("deleteMsg"),
          confirm: tc("confirm"), cancel: tc("cancel"), save: tc("save"),
          mint: t("mint"), mintTitle: t("mintTitle"), count: t("count"), label: t("label"),
          editTitle: t("editTitle"), plan: t("plan"),
          reason: t("reason"), block: t("block"), unblock: t("unblock"),
          neW: t("neW"), phone: t("phone"), search_label: tc("search"),
        }}
      />
    </div>
  );
}
