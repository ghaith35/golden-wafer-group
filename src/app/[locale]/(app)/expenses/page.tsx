import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ExpensesClient } from "./ExpensesClient";

export default async function ExpensesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("expenses");
  const tc = await getTranslations("common");
  const [types, locations] = await Promise.all([
    prisma.expenseType.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.store.findMany({ where: { companyId: session.companyId, isActive: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
  ]);
  return (
    <ExpensesClient
      types={types}
      locations={locations}
      labels={{
        title: t("title"), new: t("new"), label: t("label"), type: t("type"), van: t("location"),
        amount: t("amount"), date: t("date"), empty: t("empty"), total: tc("total"),
        search: tc("search"), edit: tc("edit"), delete: tc("delete"),
        deleteTitle: tc("deleteTitle"), deleteMessage: tc("deleteMessage"),
        save: tc("save"), cancel: tc("cancel"),
      }}
    />
  );
}
