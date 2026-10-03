import { setRequestLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { SettingsShell } from "@/components/settings/SettingsShell";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("settings");
  const session = await getSession();
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-5 md:p-6 xl:max-w-6xl 2xl:max-w-[88rem]">
      <h1 className="text-xl font-extrabold text-(--text-primary)">{t("title")}</h1>
      <SettingsShell isAdmin={session?.role === "Admin"}>{children}</SettingsShell>
    </div>
  );
}
