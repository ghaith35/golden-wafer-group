/// Pure Algiers-calendar helpers for journée auto-close (no prisma import —
/// safe for unit tests and client components).
///
/// Drivers work in Algeria regardless of the server/shop-PC timezone, so
/// "same day" is always evaluated on the Africa/Algiers calendar. Algeria
/// has no DST (UTC+1 year-round), so fixed-offset UTC math is exact.

/// Calendar day key `YYYY-MM-DD` of an instant on the Algiers calendar.
export function algiersDayKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/// 23:59:59.999 Algiers on the SAME Algiers calendar day as `d` — the stamp
/// an auto-closed journée gets (it ended with the day, not the next one).
export function endOfAlgiersDay(d: Date): Date {
  const [y, m, day] = algiersDayKey(d).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 22, 59, 59, 999));
}

/// True when `date` is strictly before "today" on the Algiers calendar.
export function isPastAlgiersDay(date: Date, now = new Date()): boolean {
  return algiersDayKey(date) < algiersDayKey(now);
}
