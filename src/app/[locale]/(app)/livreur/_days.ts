/// Pure date helpers (no prisma import — safe for client components).
import { algiersDayKey } from "@/lib/tournees/days";

/// Parse a day slug `yyyy-m-d` from the URL.
export function parseDay(slug: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(slug);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const daySlug = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/// Today's slug on the Algiers calendar. The journée (départ / fin, sales,
/// orders, cash) ALWAYS belongs to today — the day picked in the URL only
/// chooses which tour (clients + sector) is shown.
export function todaySlug(now = new Date()): string {
  const [y, m, d] = algiersDayKey(now).split("-").map(Number);
  return `${y}-${m}-${d}`;
}
