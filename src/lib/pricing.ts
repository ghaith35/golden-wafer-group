/// Shared price-tier resolution (van sale): one pure rule used by the
/// journée UI, so online, offline and tests always agree.
///
/// - `tierId null` (or unknown tier) → base sale price.
/// - tier known but the product has no price in it → base sale price
///   (a product with a single price keeps showing that price under
///   every toggle — never 0, never blank).
/// - otherwise the tier price.
export function resolveTierPrice(
  tierPrices: Array<{ tierId: string; price: unknown }> | null | undefined,
  salePrice: unknown,
  tierId: string | null | undefined,
): number {
  const base = Number(salePrice ?? 0);
  const fallback = Number.isFinite(base) ? base : 0;
  if (!tierId) return fallback;
  try {
    const hit = (tierPrices ?? []).find((x) => x && x.tierId === tierId);
    const p = Number(hit?.price);
    return Number.isFinite(p) ? p : fallback;
  } catch {
    return fallback;
  }
}

export type TierRef = { id: string; name: string };

/// Union of tier lists (server props + fresher snapshot), snapshot wins on
/// name conflicts, base sell is implicit (never a row).
export function mergeTiers(
  a: Array<TierRef> | null | undefined,
  b: Array<TierRef> | null | undefined,
): TierRef[] {
  const m = new Map<string, string>();
  try {
    for (const t of [...(a ?? []), ...(b ?? [])]) {
      if (t && typeof t.id === "string" && typeof t.name === "string") m.set(t.id, t.name);
    }
  } catch {
    /* ignore */
  }
  return [...m.entries()].map(([id, name]) => ({ id, name }));
}
