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

const DAY_MS = 86_400_000;

/// [gte, lt) UTC bounds of the Algiers calendar day containing `d` (Algeria is
/// UTC+1 year-round, so Algiers midnight = 23:00 UTC the day before). Used for
/// every "one tour per van per day" lookup so the server/shop-PC timezone can
/// never shift a tour into the wrong column.
export function algiersDayRange(d: Date): { gte: Date; lt: Date } {
  const [y, m, day] = algiersDayKey(d).split("-").map(Number);
  const gte = new Date(Date.UTC(y, m - 1, day) - 3_600_000);
  return { gte, lt: new Date(gte.getTime() + DAY_MS) };
}

/// `YYYY-MM-DD` + n days (pure calendar math, no timezone involved).
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/// Saturday-start week (DZ weekend) containing the calendar day `key`.
export function weekStartKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun = 0 … Sat = 6
  return addDaysKey(key, -((dow + 1) % 7));
}
