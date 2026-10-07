import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { isLocalMode, localEntitlement } from "@/lib/license/gate";
import { OnboardClient } from "./OnboardClient";

/// First-run only: owners create their company + admin credentials here.
/// Any existing company → this page is dead, go log in.
/// Unlicensed local install → activate first (the API is license-gated too).
export default async function OnboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (isLocalMode() && !localEntitlement().entitled) redirect(`/${locale}/activate`);
  if ((await prisma.company.count()) !== 0) redirect(`/${locale}/login`);
  const t = await getTranslations("onboard");
  return (
    <OnboardClient
      locale={locale}
      labels={{
        title: t("title"), subtitle: t("subtitle"),
        company: t("company"), fullName: t("fullName"),
        username: t("username"), password: t("password"),
        submit: t("submit"), loginNow: t("loginNow"),
      }}
    />
  );
}
