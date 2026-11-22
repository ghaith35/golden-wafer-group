import { prisma } from "@/lib/db";

type Who = { companyId: string; userId: string; role: string };

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/// Admins always choose freely. For Livreur / Vendeur the per-user flag set in
/// Settings > day access decides (default false = locked to today). Read from
/// the DB on every call so a toggle applies on the user's next screen.
export async function canChooseDay(who: Who): Promise<boolean> {
  if (who.role === "Admin") return true;
  const u = await prisma.user.findFirst({
    where: { id: who.userId, companyId: who.companyId },
    select: { canChooseDay: true },
  });
  return !!u?.canChooseDay;
}

/// May this user open the journée of `date`?
/// Free users: any day. Locked users: today only — plus the day of a journée
/// they already started and haven't ended (so a tour running past midnight
/// is never thrown out mid-work).
export async function isDayAllowed(who: Who, vanId: string | null, date: Date): Promise<boolean> {
  if (await canChooseDay(who)) return true;
  if (sameDay(date, new Date())) return true;
  if (!vanId) return false;
  const open = await prisma.tournee.findFirst({
    where: {
      companyId: who.companyId,
      locationId: vanId,
      status: "OPEN",
      startedAt: { not: null },
      finishedAt: null,
    },
    orderBy: { startedAt: "desc" },
    select: { date: true },
  });
  return !!open && sameDay(new Date(open.date), date);
}

/// A client registered from a journée screen joins that day's tour as its last
/// stop (the tour editor's "stops" list). Best-effort and idempotent: no tour
/// that day, a closed tour, an admin, or an already-planned client = no-op.
export async function addClientToDayTour(who: Who, clientId: string, daySlug: unknown): Promise<void> {
  try {
    if (who.role === "Admin") return;
    const m = typeof daySlug === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(daySlug) : null;
    if (!m) return;
    const { start, end } = dayBounds(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const van = await prisma.store.findFirst({
      where: { companyId: who.companyId, kind: "VAN", isActive: true, userId: who.userId },
      select: { id: true },
    });
    if (!van) return;
    const tour = await prisma.tournee.findFirst({
      where: { companyId: who.companyId, locationId: van.id, status: "OPEN", date: { gte: start, lte: end } },
      orderBy: { createdAt: "desc" },
      select: { id: true, stops: { select: { clientId: true, position: true } } },
    });
    if (!tour || tour.stops.some((s) => s.clientId === clientId)) return;
    const position = tour.stops.reduce((mx, s) => Math.max(mx, s.position), 0) + 1;
    await prisma.tourneeStop.create({ data: { tourneeId: tour.id, clientId, position } });
  } catch {
    /* never fail client creation over the tour link */
  }
}
