import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SuiviClient } from "./SuiviClient";

export default async function SuiviPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("tracking");
  return (
    <SuiviClient
      labels={{
        title: t("title"), refresh: t("refresh"), autoRefresh: t("autoRefresh"),
        online: t("online"), stale: t("stale"), offline: t("offline"), noSignal: t("noSignal"),
        lastSeen: t("lastSeen"), driver: t("driver"), openMaps: t("openMaps"),
        empty: t("empty"), neverSeen: t("neverSeen"),
        locate: t("locate"), locateSent: t("locateSent"),
      }}
    />
  );
}
