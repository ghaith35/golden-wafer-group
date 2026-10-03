import { setRequestLocale, getTranslations } from "next-intl/server";
import { ActivateClient } from "./ActivateClient";

export default async function ActivatePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("license");
  return (
    <ActivateClient
      labels={{
        title: t("activateTitle"), machine: t("machine"), activated: t("activated"),
        trial: t("trial"), expired: t("expired"), shopLabel: t("shopLabel"),
        trialBtn: t("trialBtn"), check: t("check"), key: t("key"), redeem: t("redeem"),
        webNote: t("webNote"), revoked: t("revoked"), locked: t("locked"),
      }}
    />
  );
}
