import { setRequestLocale, getTranslations } from "next-intl/server";
import { PortalLogin } from "./PortalLogin";

export default async function PortalLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portal");
  const tcl = await getTranslations("clients");
  return (
    <PortalLogin
      locale={locale}
      labels={{ title: t("title"), phone: tcl("phone"), secret: t("secret"), submit: t("submit"), error: t("error") }}
    />
  );
}
