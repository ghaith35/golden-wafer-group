import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SaleDocForm } from "./SaleDocForm";
import { getSaleFormData } from "./saleRefs";

export async function OrderFormLoader({
  locale,
  mode,
  channel,
  preset,
}: {
  locale: string;
  mode: "order" | "ticket";
  channel?: "VAN" | "POS" | "DEPOT";
  preset?: { clientId?: string; locationId?: string; tourneeId?: string };
}) {
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("sales");
  const tp = await getTranslations("purchases");
  const r = await getSaleFormData(session.companyId);
  if (mode === "ticket" && channel === "POS" && !r.settings.posEnabled) redirect(`/${locale}/sales`);
  return (
    <SaleDocForm
      locale={locale}
      mode={mode}
      channel={channel}
      clients={r.clients}
      products={r.products}
      units={r.units}
      tiers={r.tiers}
      locations={r.locations}
      remiseEnabled={r.settings.remiseEnabled}
      creditEnabled={r.settings.creditSalesEnabled}
      allowPieces={r.settings.pieceSalesEnabled}
      defaultTierId={r.tiers[0]?.id}
      presetClientId={preset?.clientId}
      presetLocationId={preset?.locationId}
      presetTourneeId={preset?.tourneeId}
      labels={{
        client: t("client"), searchClient: t("searchClient"), required: t("required"), walkin: t("walkin"),
        tier: t("tier"), balance: t("balance"), location: t("location"), qrScanned: t("qrScanned"),
        product: tp("product"), unit: t("unit"), qty: t("qty"), price: t("price"), lineTotal: t("lineTotal"),
        addLine: tp("addLine"), remise: t("remise"), paid: t("paid"), cashOnly: t("cashOnly"),
        total: t("total"), notes: t("notes"), save: t("save"), offlineMode: t("offlineMode"), depotStock: t("depotStock"),
      }}
    />
  );
}
