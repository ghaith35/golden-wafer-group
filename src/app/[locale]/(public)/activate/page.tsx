import { setRequestLocale, getTranslations } from "next-intl/server";
import { ActivateClient } from "./ActivateClient";

export default async function ActivatePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("license");
  return (
    <ActivateClient
      locale={locale}
      labels={{
        title: t("activateTitle"), machine: t("machine"), activated: t("activated"),
        trial: t("trial"), expired: t("expired"), shopLabel: t("shopLabel"),
        trialBtn: t("trialBtn"), check: t("check"), key: t("key"), redeem: t("redeem"),
        webNote: t("webNote"), revoked: t("revoked"), locked: t("locked"),
        goOnboard: t("goOnboard"),
        tabTrial: t("tabTrial"), tabActivate: t("tabActivate"),
        trialTitle: t("trialTitle"), trialSub: t("trialSub"),
        nameLabel: t("nameLabel"), namePh: t("namePh"),
        phoneLabel: t("phoneLabel"), phoneRequired: t("phoneRequired"), phoneInvalid: t("phoneInvalid"),
        emailLabel: t("emailLabel"),
        cityLabel: t("cityLabel"), cityPh: t("cityPh"),
        shopPh: t("shopPh"), shopRequired: t("shopRequired"),
        trialOk: t("trialOk"), genericError: t("genericError"), noInternet: t("noInternet"),
        trialBlocked: t("trialBlocked"), lockedMsg: t("lockedMsg"), lockedTitle: t("lockedTitle"),
        checkTitle: t("checkTitle"), waitingTitle: t("waitingTitle"), waitingSub: t("waitingSub"),
        cancelWait: t("cancelWait"), keyPh: t("keyPh"), keyInvalid: t("keyInvalid"), keyUsed: t("keyUsed"),
        successMsg: t("successMsg"), saveKeyTitle: t("saveKeyTitle"), saveKeySub: t("saveKeySub"),
        copyBtn: t("copyBtn"), copied: t("copied"), redirecting: t("redirecting"),
        expiredTitle: t("expiredTitle"), expiredSub: t("expiredSub"),
        daysShort: t("daysShort"), trialLeft: t.raw("trialLeft"),
        whatsappBtn: t("whatsappBtn"), waMessage: t("waMessage"),
        supportPhone: process.env.DISTRIBUILI_SUPPORT_PHONE ?? "",
      }}
    />
  );
}
