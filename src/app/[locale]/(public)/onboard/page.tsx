import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { isLocalMode, localEntitlement, isDesktopUserAgent } from "@/lib/license/gate";
import { OnboardClient } from "./OnboardClient";

/// First-run only: owners create their company + admin credentials here.
/// Any existing company → this page is dead, go log in.
/// Unlicensed local install → activate first on the desktop shell
/// (phones skip the activation gates and work regardless).
export default async function OnboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (isLocalMode() && !localEntitlement().entitled) {
    const ua = (await headers()).get("user-agent");
    if (isDesktopUserAgent(ua)) redirect(`/${locale}/activate`);
  }
  if ((await prisma.company.count()) !== 0) redirect(`/${locale}/login`);
  const t = await getTranslations("onboard");
  return (
    <OnboardClient
      locale={locale}
      offlineInstall={isLocalMode()}
      labels={{
        title: t("title"), subtitle: t("subtitle"),
        company: t("company"), fullName: t("fullName"), email: t("email"), phone: t("phone"), password: t("password"),
        submit: t("submit"), creating: t("creating"),
        heroTitle: t("heroTitle"), heroCopy: t("heroCopy"), distributionLabel: t("distributionLabel"),
        inventoryTitle: t("inventoryTitle"), inventoryDetail: t("inventoryDetail"),
        partnersTitle: t("partnersTitle"), partnersDetail: t("partnersDetail"),
        accountsTitle: t("accountsTitle"), accountsDetail: t("accountsDetail"),
        offlineNote: t("offlineNote"), startNote: t("startNote"),
        progressLabel: t("progressLabel"), complete: t("complete"), stepAccount: t("stepAccount"), stepSetup: t("stepSetup"),
        showPassword: t("showPassword"), hidePassword: t("hidePassword"), loginHint: t("loginHint"),
        alreadyOnboarded: t("alreadyOnboarded"), rateLimited: t("rateLimited"),
        validationError: t("validationError"), createFailed: t("createFailed"),
      }}
    />
  );
}
