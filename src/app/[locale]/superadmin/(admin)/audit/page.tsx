import { setRequestLocale, getTranslations } from "next-intl/server";
import { AuditClient } from "./AuditClient";

export default async function SuperAdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("common");
  return (
    <AuditClient
      labels={{
        title: t("audit"),
        entriesLine: t.raw("entriesLine"),
        search: tc("search"),
        filter: t("auditFilter"),
        empty: t("empty"),
        colWhen: t("colWhen"),
        colUser: t("colUser"),
        colAction: t("colAction"),
        colEntity: t("colEntity"),
        colDetails: t("colDetails"),
      }}
    />
  );
}
