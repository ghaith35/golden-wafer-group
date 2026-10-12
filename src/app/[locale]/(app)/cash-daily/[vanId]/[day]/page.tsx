import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { cashMonth } from "@/lib/cash/daily";
import { HandoverClient } from "./HandoverClient";

/// تسليم الصندوق as a section: full van-day handover workspace with inline
/// declare / remit / close (no popups) + remittance history. Staff see only
/// their own van; remit/close/delete stay Admin-only (API-enforced too).
export default async function HandoverPage({
  params,
}: {
  params: Promise<{ locale: string; vanId: string; day: string }>;
}) {
  const { locale, vanId, day } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) notFound();
  const t = await getTranslations("cashDaily");
  const isAdmin = session.role === "Admin";
  if (!isAdmin) {
    const own = await prisma.store.findFirst({
      where: { companyId: session.companyId, kind: "VAN", isActive: true, userId: session.userId },
      select: { id: true },
    });
    if (!own || own.id !== vanId) redirect(`/${locale}/cash-daily`);
  }
  const van = await prisma.store.findFirst({
    where: { id: vanId, companyId: session.companyId },
    select: { id: true, name: true, matricule: true },
  });
  if (!van) notFound();
  const [y, m] = day.split("-").map(Number);
  const data = await cashMonth(session.companyId, y, m);
  const row = data.rows.find((r) => r.vanId === vanId && r.dayIso === day) ?? null;
  const versements = await prisma.versement.findMany({
    where: { companyId: session.companyId, kind: "CASH_COLLECTION", locationId: vanId, date: new Date(`${day}T00:00:00`) },
    orderBy: { date: "asc" },
  });
  return (
    <HandoverClient
      locale={locale}
      van={van}
      dayIso={day}
      row={row ? JSON.parse(JSON.stringify(row)) : null}
      remits={JSON.parse(JSON.stringify(versements))}
      isAdmin={isAdmin}
      labels={{
        title: t("declare"), van: t("van"), expected: t("expected"), collected: t("collected"),
        credit: t("credit"), clientPayments: t("clientPayments"), expenses: t("expenses"),
        returnsCash: t("returnsCash"), dueCash: t("dueCash"), declared: t("declared"),
        remitted: t("remitted"), difference: t("difference"), declare: t("declare"),
        remit: t("remit"), close: t("close"), reopen: t("reopen"), history: t("history"),
        remaining: t("remaining"), empty: t("empty"), amount: t("amount"), notes: t("notes"),
        save: t("save"), cancel: t("cancel"), sales: t("sales"),
        stOpen: t("stOpen"), stDeclared: t("stDeclared"), stClosed: t("stClosed"),
      }}
    />
  );
}
