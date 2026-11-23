/// Promotion window of a gift rule — PURE (server, admin UI, driver page and
/// the offline phone all use it). Dates are inclusive whole days: `endsAt` is
/// stored as the last millisecond of the end day.

export type RuleWindow = { startsAt?: string | Date | null; endsAt?: string | Date | null };
export type WindowState = "scheduled" | "live" | "expired";

const ms = (d: string | Date | null | undefined): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
};

export function windowState(w: RuleWindow, now: Date | number = Date.now()): WindowState {
  const t = typeof now === "number" ? now : now.getTime();
  const s = ms(w.startsAt);
  const e = ms(w.endsAt);
  if (e != null && t > e) return "expired";
  if (s != null && t < s) return "scheduled";
  return "live";
}

/// "YYYY-MM-DD" (date input) → start / end of that local day.
export function dayStart(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0) : null;
}
export function dayEnd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999) : null;
}
/// ISO / Date → "YYYY-MM-DD" in local time (for <input type="date">).
export function toYmd(d: string | Date | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
/// Calendar days from today to the end day (0 = ends today; null = no end date).
export function daysLeft(endsAt: string | Date | null | undefined, now: Date | number = Date.now()): number | null {
  const e = ms(endsAt);
  if (e == null) return null;
  const a = new Date(e);
  const b = new Date(typeof now === "number" ? now : now.getTime());
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((da - db) / 86400000));
}
