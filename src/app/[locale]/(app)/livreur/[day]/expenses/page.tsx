import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { SALARY_TYPE_NAME } from "@/lib/employees/service";
import { VanExpensesClient } from "./VanExpensesClient";

/// Van expenses section (both staff roles, own van only): list + create +
/// edit + delete, fully offline-capable via the expense/expense-update/
/// expense-delete outbox ops. Admins manage everything from المصاريف.
export default async function LivreurExpensesPage({
  params,
}: {
  params: Promise<{ locale: string; day: string }>;
}) {
  const { locale, day } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const date = parseDay(day);
  if (!date) redirect(`/${locale}/livreur`);
  const t = await getTranslations("livreur");
  const tc = await getTranslations("common");
  const tm = await getTranslations("cashDaily");
  const ts = await getTranslations("sync");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  const [rows, types] = await Promise.all([
    prisma.expense.findMany({
      where: { companyId: session.companyId, locationId: van.id, deletedAt: null },
      orderBy: { expenseDate: "desc" },
      take: 200,
    }),
    // Payroll's auto-created "Salaires" type is not something a driver books.
    prisma.expenseType.findMany({
      where: { companyId: session.companyId, isActive: true, name: { not: SALARY_TYPE_NAME } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <VanExpensesClient
      locale={locale}
      day={day}
      vanId={van.id}
      vanName={van.name}
      rows={JSON.parse(JSON.stringify(rows))}
      types={types}
      labels={{
        title: t("expense"),
        expenseNote: t("expenseNote"),
        expenseTypes: t("expenseTypes"),
        expenseOptional: t("expenseOptional"),
        expensePickType: t("expensePickType"),
        expenseNoTypes: t("expenseNoTypes"),
        expenseNotePh: t("expenseNotePh"),
        amount: tm("amount"),
        date: tc("date"),
        save: tc("save"),
        cancel: tc("cancel"),
        edit: tc("edit"),
        delete: tc("delete"),
        deleteConfirm: t("deleteExpenseConfirm"),
        yes: t("yes"),
        no: t("no"),
        total: t("total"),
        empty: t("empty"),
        online: t("online"),
        offline: t("offline"),
        queuedOk: t("queuedOk"),
        failed: ts("failed"),
      }}
    />
  );
}
