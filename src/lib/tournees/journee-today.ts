import { prisma } from "@/lib/db";
import { ensureDayTours } from "@/lib/tournees/plans";
import { algiersDayKey, algiersDayRange } from "@/lib/tournees/days";
import { pickCurrentTour, sortDayTours } from "@/lib/tournees/day-tours";

/// THE journée rule: départ / fin de journée, sales, orders and cash always
/// belong to TODAY (Algiers calendar). The day picked in the URL only decides
/// which tour — its clients and sector — is displayed.
///
/// These helpers return today's tour(s) for a van, whatever day the driver is
/// looking at. When the picked day IS today they are the same rows the screens
/// always used, so normal use is unchanged.

const select = {
  id: true, status: true, startedAt: true, finishedAt: true, slot: true, createdAt: true, date: true,
  secteur: { select: { name: true } }, _count: { select: { stops: true } },
} as const;

/// Today's tours of the van (one or two), sorted. Recurring plans generate
/// them on demand, like for any other day.
export async function todayTours(companyId: string, vanId: string, now = new Date()) {
  await ensureDayTours(companyId, vanId, algiersDayKey(now));
  return sortDayTours(
    await prisma.tournee.findMany({
      where: { companyId, locationId: vanId, date: algiersDayRange(now) },
      select,
    }),
  );
}

/// The journée being driven today (in progress, else next waiting, else last).
export async function todayJourneeTour(companyId: string, vanId: string, now = new Date()) {
  return pickCurrentTour(await todayTours(companyId, vanId, now));
}
