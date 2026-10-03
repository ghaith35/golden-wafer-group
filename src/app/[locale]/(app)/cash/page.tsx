import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { CashClient } from "./CashClient";

export default async function CashPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("cash");
  const tc = await getTranslations("common");
  const [clients, suppliers, settings] = await Promise.all([
    prisma.customer.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.supplier.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" }, take: 500 }),
    getOrCreateSettings(session.companyId),
  ]);
  return (
    <CashClient
      clients={JSON.parse(JSON.stringify(clients)).map((c: { balance: unknown } & Record<string, unknown>) => ({ ...c, balance: Number(c.balance) }))}
      suppliers={JSON.parse(JSON.stringify(suppliers)).map((s: { balance: unknown } & Record<string, unknown>) => ({ ...s, balance: Number(s.balance) }))}
      depositsOn={settings.depositsEnabled}
      labels={{
        title: t("title"), versements: t("versements"), deposits: t("deposits"),
        CLIENT_PAYMENT: t("clientPayment"), SUPPLIER_PAYMENT: t("supplierPayment"),
        newVersement: t("newVersement"), newDeposit: t("newDeposit"),
        amount: t("amount"), empty: t("empty"), queued: t("queued"),
        search: tc("search"), total: tc("total"),
      }}
    />
  );
}
