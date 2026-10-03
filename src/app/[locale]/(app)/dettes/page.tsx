import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DettesClient } from "./DettesClient";

export default async function DettesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("debts");
  const tn = await getTranslations("nav");
  return (
    <DettesClient
      labels={{
        title: t("title"), clients: t("clients"), suppliers: t("suppliers"),
        clientsTitle: tn("debtsClients"), suppliersTitle: tn("debtsSuppliers"),
        total: t("total"), paid: t("paid"), balance: t("balance"), status: t("status"),
        unpaid: t("unpaid"), partial: t("partial"), settled: t("settled"), all: t("all"),
        search: t("search"), pay: t("pay"), payTitle: t("payTitle"), amount: t("amount"),
        date: t("date"), notes: t("notes"), save: t("save"), cancel: t("cancel"),
        empty: t("empty"), history: t("history"), openDocs: t("openDocs"),
        lastActivity: t("lastActivity"), overpayment: t("overpayment"), noBalance: t("noBalance"),
        appliedTo: t("appliedTo"),
      }}
    />
  );
}
