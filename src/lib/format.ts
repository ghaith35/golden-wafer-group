/// Algerian number formatting: NBSP-grouped thousands, dot decimals.
///   dz(1000)      → "1 000"      (quantities, counts)
///   dzMoney(1000) → "1 000 DA"   (money everywhere)
/// NBSP (not a regular space) so the group never splits in RTL bidi
/// ("2 296 قطعة" stays "2 296", never flips to "296 2") and never
/// breaks across lines. Renders as a plain space on receipts/SMS/printers.
///
/// Bidi isolation: both helpers wrap the result in U+2066 LRI … U+2069 PDI
/// (invisible, zero-width). Without this, an Arabic RTL page reorders
/// "74 766 DA" into "DA 766 74" — the Latin "DA" run jumps to the front
/// and digit groups shuffle inside mixed strings. The isolates make every
/// price render as one LTR unit in ANY context (JSX, template strings like
/// `تأكيد · 74 766 DA`, placeholders, button labels) with zero per-file
/// `dir="ltr"` needed — current and future call sites are safe by default.

// LEFT-TO-RIGHT ISOLATE / POP DIRECTIONAL ISOLATE (explicit escapes —
// never paste literal invisible chars here).
const LRI = "\u2066";
const PDI = "\u2069";

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function core(v: number, maxFrac: number): string {
  const neg = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const fixed = abs.toFixed(maxFrac);
  const [i, d] = fixed.split(".");
  const dec = d && Number(d) > 0 ? `.${d}` : "";
  return `${neg}${group(i)}${dec}`;
}

export function dz(v: number, maxFrac = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${LRI}${core(v, maxFrac)}${PDI}`;
}

export function dzMoney(v: number, maxFrac?: number): string {
  if (!Number.isFinite(v)) return "—";
  const frac = maxFrac ?? (Math.abs(v) < 1000 && v % 1 !== 0 ? 2 : 0);
  return `${LRI}${core(v, frac)} DA${PDI}`;
}

/// Date + hour for record rows (sales, orders, expenses…): short local date
/// plus HH:MM, e.g. "02/10/2026 · 14:35". Invalid dates render "—".
///
/// Timezone is pinned to the business calendar (Africa/Algiers): the prod
/// server runs on UTC while the browsers run on Algiers time, and an
/// unpinned toLocale* renders different strings on each side — a React
/// hydration mismatch (#418) that crashes the whole page. Never format a
/// stored instant without this pin.
export const BUSINESS_TZ = "Africa/Algiers";

export function fmtDT(value: string | Date | null | undefined, locale: string): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return `${d.toLocaleDateString(locale, { timeZone: BUSINESS_TZ })} · ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_TZ })}`;
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " · ");
  }
}
