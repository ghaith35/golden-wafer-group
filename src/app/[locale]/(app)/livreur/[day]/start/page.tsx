import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getLivreurVan } from "../../_data";
import { parseDay } from "../../_days";
import { todayTours } from "@/lib/tournees/journee-today";
import { canChooseDay as userCanChooseDay, isDayAllowed } from "@/lib/livreur/day-access";
import { StartClient } from "./StartClient";
import { ensureDayTours } from "@/lib/tournees/plans";
import { pickCurrentTour, sortDayTours } from "@/lib/tournees/day-tours";
import { algiersDayKey } from "@/lib/tournees/days";

/// Interstitial after picking a day: live clock + validate to start.
export default async function LivreurStartPage({
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
  const van = await getLivreurVan(session.companyId, session.userId);
  if (!van) redirect(`/${locale}/livreur`);

  if (!(await isDayAllowed(session, van.id, date))) redirect(`/${locale}/livreur`);
  const canChoose = await userCanChooseDay(session);

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  // The journée (départ / fin) is ALWAYS today's. The picked day only decides
  // which tour — its clients and sector — is shown (stops count below).
  const jTours = await todayTours(session.companyId, van.id);
  const tournee = pickCurrentTour(jTours);
  await ensureDayTours(session.companyId, van.id, algiersDayKey(dayStart));
  const viewTours = sortDayTours(
    await prisma.tournee.findMany({
      where: { companyId: session.companyId, locationId: van.id, date: { gte: dayStart, lte: dayEnd } },
      select: { id: true, slot: true, createdAt: true, status: true, startedAt: true, finishedAt: true, _count: { select: { stops: true } } },
    }),
  );
  const viewTour = pickCurrentTour(viewTours);

  return (
    <StartClient
      locale={locale}
      day={day}
      dateIso={date.toISOString()}
      vanName={van.name}
      tours={jTours.map((x) => ({ id: x.id, secteurName: x.secteur?.name ?? null, stopsCount: x._count.stops, startedAt: x.startedAt ? new Date(x.startedAt).toISOString() : null, finishedAt: x.finishedAt ? new Date(x.finishedAt).toISOString() : null }))}
      tourneeId={tournee?.id ?? null}
      startedAt={tournee?.startedAt ? new Date(tournee.startedAt).toISOString() : null}
      stopsCount={viewTour?._count.stops ?? 0}
      canChooseDay={canChoose}
      labels={{ startDay: t("startDay"), clients: t("clients"), gpsWhy: t("gpsWhy"), gpsDenied: t("gpsDenied"), gpsGranted: t("gpsGranted"), dayQueued: t("dayQueued"), tourOf: t.raw("tourOf") as string, tourRunning: t("tourRunning"), tourDone: t("tourDone"), tourWait: t("tourWait"), finishOtherFirst: t("finishOtherFirst") }}
    />
  );
}
