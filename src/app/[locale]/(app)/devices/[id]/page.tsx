import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DeviceDetail } from "./DeviceDetail";

export default async function DevicePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.role !== "Admin") redirect(`/${locale}/dashboard`);
  const t = await getTranslations("sync");
  return (
    <DeviceDetail
      deviceId={id}
      locale={locale}
      labels={{ failedOps: t("failedOps"), retry: t("retry"), lastSync: t("lastSync"), unbound: t("unbound") }}
    />
  );
}
