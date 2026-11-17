export const REF_PREFIX = "REF-";
const PAD = 5;

/// "REF-00042" for 42. Numbers past 99999 simply grow (REF-100000).
export function formatReference(n: number): string {
  return `${REF_PREFIX}${String(Math.max(1, Math.floor(n))).padStart(PAD, "0")}`;
}

/// Next free sequential reference given every existing reference of the company.
/// Only values of the form REF-<digits> take part in the sequence (user-typed
/// custom references are ignored, never clobbered). Guaranteed not to collide
/// with any existing reference (case-insensitive).
export function nextReference(existing: Array<string | null | undefined>): string {
  const taken = new Set<string>();
  let max = 0;
  for (const raw of existing) {
    const v = (raw ?? "").trim().toUpperCase();
    if (!v) continue;
    taken.add(v);
    const m = /^REF-(\d{1,9})$/.exec(v);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (taken.has(formatReference(n))) n++;
  return formatReference(n);
}
