import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listSeasons } from "@/lib/season/seasons";
import { cashMonth } from "@/lib/cash/daily";
import { CashDailyClient } from "./CashDailyClient";

/// صندوق اليوم: expected vs collected vs remitted per van-day.
/// Same range/strip UX as presence.
export default async function CashDailyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("cashDaily");
  const now = new Date();
  const seasons = await listSeasons(session.companyId);
  const years = [...new Set(seasons.map((s) => s.year))].sort((a, b) => b - a);
  const year = Number(sp.year) || now.getFullYear();
  const months = seasons.filter((s) => s.year === year).map((s) => s.month);
  if (!months.includes(now.getMonth() + 1)) months.push(now.getMonth() + 1);
  months.sort((a, b) => b - a);
  const month = months.includes(Number(sp.month)) ? Number(sp.month) : now.getMonth() + 1;

  const data = await cashMonth(session.companyId, year, month);
  // Livreur sees only his own van (same rule as the API).
  let vans = data.vans;
  let rows = data.rows;
  const isAdmin = session.role === "Admin";
  if (!isAdmin) {
    const van = await prisma.store.findFirst({
      where: { companyId: session.companyId, kind: "VAN", isActive: true, userId: session.userId },
      select: { id: true },
    });
    vans = vans.filter((v) => v.id === van?.id);
    rows = rows.filter((r) => r.vanId === van?.id);
  }
  return (
    <CashDailyClient
      locale={locale}
      year={year}
      month={month}
      years={years.length ? years : [now.getFullYear()]}
      months={months}
      vans={vans}
      rows={JSON.parse(JSON.stringify(rows))}
      isAdmin={isAdmin}
      labels={{
        title: t("title"), van: t("van"), expected: t("expected"), collected: t("collected"),
        credit: t("credit"), clientPayments: t("clientPayments"), expenses: t("expenses"),
        returnsCash: t("returnsCash"), dueCash: t("dueCash"), declared: t("declared"),
        remitted: t("remitted"), difference: t("difference"), declare: t("declare"),
        remit: t("remit"), close: t("close"), reopen: t("reopen"),
        stOpen: t("stOpen"), stDeclared: t("stDeclared"), stClosed: t("stClosed"),
        empty: t("empty"), amount: t("amount"), notes: t("notes"),
        save: t("save"), cancel: t("cancel"), sales: t("sales"), by: t("by"),
        history: t("history"), remaining: t("remaining"),
      }}
    />
  );
}
