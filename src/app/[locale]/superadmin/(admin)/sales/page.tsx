import { setRequestLocale, getTranslations } from "next-intl/server";
import { SalesClient } from "./SalesClient";

export default async function SuperAdminSalesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("superadmin");
  return <SalesClient labels={{
    title: t("sales"), subtitle: t("salesSubtitle"), search: t("searchSales"), company: t("company"),
    allCompanies: t("allCompanies"), kind: t("documentKind"), allKinds: t("allKinds"), status: t("status"),
    allStatuses: t("allStatuses"), date: t("date"), number: t("documentNumber"), customer: t("customer"),
    location: t("location"), createdBy: t("createdBy"), lines: t("lines"), total: t("total"), paid: t("paid"),
    empty: t("emptySales"), loading: t("loading"), previous: t("previous"), next: t("next"), page: t("page"),
    ORDER: t("kindOrder"), DELIVERY: t("kindDelivery"), INVOICE: t("kindInvoice"), TICKET: t("kindTicket"),
    DRAFT: t("statusDraft"), CONFIRMED: t("statusConfirmed"), DELIVERED: t("statusDelivered"),
    INVOICED: t("statusInvoiced"), CANCELLED: t("statusCancelled"),
    channel: t("channel"), notes: t("notes"), showDetails: t("showDetails"), hideDetails: t("hideDetails"),
    load_failed: t("loadFailed"),
  }} />;
}