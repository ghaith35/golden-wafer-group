/// Recurring-tour calendar maths — PURE (no prisma, no clock), shared by the
/// server, the admin board and the tests. All dates are Algiers-calendar day
/// keys "YYYY-MM-DD" (the same keys `days.ts` uses), so no timezone can shift
/// a tour into the wrong column.

import { addDaysKey } from "./days";

export type PlanShape = {
  /// 0 = Sunday … 6 = Saturday.
  weekday: number;
  /// 1 = every week, 2 = every 2 weeks.
  intervalWeeks: number;
  /// First occurrence "YYYY-MM-DD".
  anchorKey: string;
  /// "YYYY-MM-DD,YYYY-MM-DD" removed single dates.
  skips?: string | null;
};

/// Weekday (0 = Sunday … 6 = Saturday) of a calendar key.
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/// Whole days from key a to key b (calendar math, no timezone).
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function parseSkips(skips: string | null | undefined): Set<string> {
  return new Set((skips ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}
export function withSkip(skips: string | null | undefined, key: string): string {
  const s = parseSkips(skips);
  s.add(key);
  return [...s].sort().join(",");
}

/// Is the plan due on this calendar day? Same weekday, on/after the anchor,
/// a whole number of intervals after it, and not a removed date.
export function isPlanDue(plan: PlanShape, key: string): boolean {
  if (weekdayOfKey(key) !== plan.weekday) return false;
  if (key < plan.anchorKey) return false;
  const interval = Math.max(1, Math.floor(plan.intervalWeeks || 1));
  const weeks = daysBetween(plan.anchorKey, key) / 7;
  if (!Number.isInteger(weeks) || weeks % interval !== 0) return false;
  return !parseSkips(plan.skips).has(key);
}

/// Every due day in [fromKey, toKey] (inclusive), oldest first. Capped so a
/// huge range can never loop for long.
export function dueKeys(plan: PlanShape, fromKey: string, toKey: string, cap = 400): string[] {
  const out: string[] = [];
  if (toKey < fromKey) return out;
  const start = fromKey < plan.anchorKey ? plan.anchorKey : fromKey;
  // First day on/after `start` with the plan's weekday.
  let key = addDaysKey(start, (plan.weekday - weekdayOfKey(start) + 7) % 7);
  while (key <= toKey && out.length < cap) {
    if (isPlanDue(plan, key)) out.push(key);
    key = addDaysKey(key, 7);
  }
  return out;
}

/// The next due day on/after `fromKey` (searching ahead at most a year).
export function nextDueKey(plan: PlanShape, fromKey: string): string | null {
  const all = dueKeys(plan, fromKey, addDaysKey(fromKey, 400), 1);
  return all[0] ?? null;
}
