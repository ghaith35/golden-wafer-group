import { setRequestLocale, getTranslations } from "next-intl/server";
import { AuditClient } from "./AuditClient";

export default async function SuperAdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  const tc = await getTranslations("common");
  return (
    <div>
      <h1 className="mb-3 text-xl font-black">{t("audit")}</h1>
      <AuditClient labels={{ search: tc("search"), empty: t("empty") }} />
    </div>
  );
}
