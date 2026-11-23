import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "./_data";
import { ensureDayTours } from "@/lib/tournees/plans";
import { dayFinished } from "@/lib/tournees/day-tours";
import { algiersDayKey } from "@/lib/tournees/days";
import { daySlug } from "./_days";
import { DaysClient } from "./DaysClient";

/// Step 1 — Journée: pick a weekday, then go to its clients.
/// Locked while a journée is open (started, not finished): jumps straight
/// into its dashboard — the clock page only shows before départ is stamped.
/// Finishing re-opens this page.
export default async function LivreurDaysPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("livreur");
  const van = await getLivreurVan(session.companyId, session.userId);
  if (van) {
    const open = await prisma.tournee.findFirst({
      where: {
        companyId: session.companyId,
        locationId: van.id,
        status: "OPEN",
        startedAt: { not: null },
        finishedAt: null,
      },
      orderBy: { startedAt: "desc" },
      select: { date: true },
    });
    if (open) redirect(`/${locale}/livreur/${daySlug(new Date(open.date))}/dashboard`);
    // Tour workflow: the START screen is the first thing the driver sees.
    // (Admins and employees allowed to choose the day keep the plain day list.)
    if (session.role !== "Admin") {
      const now = new Date();
      const today = daySlug(now);
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(now);
      dayEnd.setHours(23, 59, 59, 999);
      // Recurring plans generate today's tours on demand (one or two).
      await ensureDayTours(session.companyId, van.id, algiersDayKey(now)).catch(() => {});
      const todays = await prisma.tournee.findMany({
        where: { companyId: session.companyId, locationId: van.id, date: { gte: dayStart, lte: dayEnd } },
        select: { startedAt: true, finishedAt: true, status: true, slot: true, createdAt: true },
      });
      // Every tour of today driven to the end → the (ended) dashboard: goods
      // request is open now. A second tour still waiting → back to start.
      if (todays.some((x) => x.startedAt) && dayFinished(todays)) redirect(`/${locale}/livreur/${today}/dashboard`);
      redirect(`/${locale}/livreur/${today}/start`);
    }
  }
  return (
    <DaysClient
      locale={locale}
      van={van ? JSON.parse(JSON.stringify(van)) : null}
      labels={{ title: session.role === "Vendeur" ? t("getCommand") : t("title"), days: t("days"), empty: t("empty") }}
    />
  );
}
