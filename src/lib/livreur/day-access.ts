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
