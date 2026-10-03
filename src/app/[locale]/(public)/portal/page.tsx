import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal/session";
import { PortalShop } from "./PortalShop";

export default async function PortalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getPortalSession();
  if (!session) redirect(`/${locale}/portal/login`);
  const t = await getTranslations("portal");
  const tc = await getTranslations("common");
  return (
    <PortalShop
      locale={locale}
      labels={{
        shop: t("shop"), orders: t("orders"), search: tc("search"),
        inStock: t("inStock"), outStock: t("outStock"), order: t("order"),
      }}
    />
  );
}
