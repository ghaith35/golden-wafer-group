import { setRequestLocale, getTranslations } from "next-intl/server";
import { SuperAdminLogin } from "./LoginForm";

export default async function SuperAdminLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  return (
    <SuperAdminLogin
      locale={locale}
      labels={{
        title: t("loginTitle"), subtitle: t("loginSub"), username: t("username"),
        password: t("password"), login: t("login"),
        invalid_credentials: t("invalidCredentials"), rate_limited: t("rateLimited"),
      }}
    />
  );
}
