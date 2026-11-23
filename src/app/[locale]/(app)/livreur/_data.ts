import { prisma } from "@/lib/db";
import { closeStaleDays } from "@/lib/tournees/service";
import { ensureDayTours } from "@/lib/tournees/plans";
import { pickCurrentTour } from "@/lib/tournees/day-tours";
import { algiersDayKey } from "@/lib/tournees/days";

export type LivVan = { id: string; name: string; matricule: string | null };

export async function getLivreurVan(companyId: string, userId: string): Promise<LivVan | null> {
  return prisma.store.findFirst({
    where: { companyId, kind: "VAN", isActive: true, userId },
    select: { id: true, name: true, matricule: true },
  });
}

/// Départ/fin stamps of the van's tour on a given day (null = no tour yet).
export async function getDayStamp(
  companyId: string,
  vanId: string,
  date: Date,
): Promise<{ startedAt: string | null; finishedAt: string | null } | null> {
  // A journée ends with its own day: close any past, still-open one first so
  // the driver never sees yesterday's tour as "in progress".
  await closeStaleDays(companyId).catch(() => {});
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  // Recurring plans generate their tours on demand — make sure today's exist.
  await ensureDayTours(companyId, vanId, algiersDayKey(start));
  // Up to two tours that day: the stamp is the one being driven (else the next
  // waiting, else the last finished).
  const t = pickCurrentTour(
    await prisma.tournee.findMany({
      where: { companyId, locationId: vanId, date: { gte: start, lte: end } },
      select: { startedAt: true, finishedAt: true, slot: true, createdAt: true, status: true },
    }),
  );
  if (!t) return null;
  return {
    startedAt: t.startedAt ? t.startedAt.toISOString() : null,
    finishedAt: t.finishedAt ? t.finishedAt.toISOString() : null,
  };
}
