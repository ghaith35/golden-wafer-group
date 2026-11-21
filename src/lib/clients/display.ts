/// One place for how a client is searched, labelled and located, so every
/// screen (admin, livreur, prévendeur) behaves the same.

/// Shown when a record has no client name (deleted/unknown). Walk-in sales
/// pass their own localized label instead.
export const NO_CLIENT = "—";

export function clientLabel(name: string | null | undefined, fallback: string = NO_CLIENT): string {
  const n = (name ?? "").trim();
  return n || fallback;
}

/// Search normal form: case-insensitive, accent-insensitive, and tolerant of
/// the usual Arabic spelling variants (أ إ آ → ا · ى → ي · ة → ه · tashkeel),
/// so "mini" finds "Mini Shop", "Malak" finds "malak", "احمد" finds "أحمد".
export function normSearch(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .trim();
}

/// True when every word typed appears in the client's name, code or phone.
export function matchClient(
  q: string,
  c: { name?: string | null; code?: string | null; phone?: string | null },
): boolean {
  const words = normSearch(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${normSearch(c.name)} ${normSearch(c.code)} ${normSearch(c.phone)}`;
  return words.every((w) => hay.includes(w));
}

/// Google Maps link to the client's GPS point (opens the Maps app on phones).
/// null when the client has no usable coordinates.
export function clientMapsUrl(lat: unknown, lng: unknown): string | null {
  const a = lat == null || lat === "" ? NaN : Number(lat);
  const b = lng == null || lng === "" ? NaN : Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${a},${b}`;
}
