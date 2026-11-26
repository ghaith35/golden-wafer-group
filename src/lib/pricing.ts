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

// ─── Quantity ladder (per colisage) ──────────────────────────────────────────
//
// A product can say, for each of its colisages: "from qty N use tier X".
//   Carton:  0 → سعر البيع · 10 → سعر الجملة · 50 → سوبر جملة
// The active rung is the one with the greatest minQty ≤ qty. Rungs reuse the
// product's existing tier prices (tierId null = the base sale price), so the
// ladder never stores a price of its own. One pure rule shared by the server,
// the web sale forms and the offline van app.

export type QtyRung = { unitKey: string; minQty: number; tierId: string | null };

/// Ladder key of a sale line's unit: base unit / no unit → "", else the unit id.
export function qtyUnitKey(unitId: string | null | undefined, baseUnitId: string | null | undefined): string {
  return !unitId || unitId === baseUnitId ? "" : unitId;
}

/// Clean ladder for one unit: finite minQty ≥ 0, ascending, one rung per minQty.
export function ladderOf(rungs: Array<QtyRung> | null | undefined, unitKey: string): QtyRung[] {
  const seen = new Set<number>();
  const out: QtyRung[] = [];
  try {
    for (const r of [...(rungs ?? [])].filter((x) => x && x.unitKey === unitKey).sort((a, b) => Number(a.minQty) - Number(b.minQty))) {
      const m = Number(r.minQty);
      if (!Number.isFinite(m) || m < 0 || seen.has(m)) continue;
      seen.add(m);
      out.push({ unitKey, minQty: m, tierId: r.tierId ?? null });
    }
  } catch {
    /* garbage in → empty ladder, normal pricing */
  }
  return out;
}

export type QtyPick = { rung: QtyRung; index: number; next: QtyRung | null; ladder: QtyRung[] };

/// Rung that prices `qty` (null = no ladder for this unit, or qty is below the
/// first rung → fall back to the normal tier price).
export function pickRung(rungs: Array<QtyRung> | null | undefined, unitKey: string, qty: number): QtyPick | null {
  const ladder = ladderOf(rungs, unitKey);
  if (ladder.length === 0) return null;
  const q = Number(qty);
  if (!Number.isFinite(q)) return null;
  let index = -1;
  for (let i = 0; i < ladder.length; i++) if (ladder[i].minQty <= q + 1e-9) index = i;
  if (index < 0) return null;
  return { rung: ladder[index], index, next: ladder[index + 1] ?? null, ladder };
}

export type QtyPriceInput = {
  tierPrices: Array<{ tierId: string; price: unknown }> | null | undefined;
  salePrice: unknown;
  rungs: Array<QtyRung> | null | undefined;
  /// Ladder key of the line's unit (see qtyUnitKey).
  unitKey: string;
  qty: number;
  /// Base units per line unit (1 for the base unit).
  factor: number;
  /// Tier used when no rung applies (the client's / toggled tier).
  fallbackTierId?: string | null;
};

/// Price of ONE line unit at this quantity (+ the tier that produced it).
export function priceForQty(i: QtyPriceInput): { unitPrice: number; tierId: string | null; pick: QtyPick | null } {
  const pick = pickRung(i.rungs, i.unitKey, i.qty);
  const tierId = pick ? pick.rung.tierId : (i.fallbackTierId ?? null);
  const f = Number.isFinite(i.factor) && i.factor > 0 ? i.factor : 1;
  return { unitPrice: resolveTierPrice(i.tierPrices, i.salePrice, tierId) * f, tierId, pick };
}

/// "Add N more to unlock a lower price": the next rung, how many units away it
/// is, and what each unit would then cost (null when already on the last rung
/// or the next rung is not cheaper).
export function nextRungHint(i: QtyPriceInput): { missing: number; atQty: number; tierId: string | null; unitPrice: number; saving: number; pct: number } | null {
  const cur = priceForQty(i);
  const next = cur.pick?.next ?? (cur.pick ? null : ladderOf(i.rungs, i.unitKey)[0] ?? null);
  if (!next) return null;
  const f = Number.isFinite(i.factor) && i.factor > 0 ? i.factor : 1;
  const unitPrice = resolveTierPrice(i.tierPrices, i.salePrice, next.tierId) * f;
  if (!(unitPrice < cur.unitPrice - 1e-9) || !(cur.unitPrice > 0)) return null;
  const missing = Math.max(0, Math.ceil((next.minQty - Number(i.qty)) * 1000 - 1e-6) / 1000);
  if (missing <= 0) return null;
  return { missing, atQty: next.minQty, tierId: next.tierId, unitPrice, saving: cur.unitPrice - unitPrice, pct: Math.round((1 - unitPrice / cur.unitPrice) * 100) };
}

/// Minimal product shape the sale screens hand to the ladder helpers.
export type LadderProduct = {
  baseUnitId?: string | null;
  salePrice: unknown;
  tierPrices?: Array<{ tierId: string; price: unknown }> | null;
  qtyTiers?: Array<QtyRung> | null;
  conversions?: Array<{ unitId: string; factor: unknown }> | null;
};

/// Base units per line unit (1 for the base unit), piece factors normalised to exact 1/N.
export function lineFactorOf(p: LadderProduct, unitId: string | null | undefined): number {
  if (!unitId || unitId === p.baseUnitId) return 1;
  const f = Number((p.conversions ?? []).find((c) => c.unitId === unitId)?.factor);
  if (!(f > 0)) return 1;
  return f < 1 ? 1 / Math.round(1 / f) : f;
}

/// Everything a sale line needs at once: the unit price at this quantity, the
/// tier that produced it and the "add N more" hint. `hasLadder` tells the UI
/// whether to show the ladder strip at all.
export function ladderLine(p: LadderProduct, unitId: string | null | undefined, qty: number, fallbackTierId: string | null) {
  const input: QtyPriceInput = {
    tierPrices: p.tierPrices,
    salePrice: p.salePrice,
    rungs: p.qtyTiers,
    unitKey: qtyUnitKey(unitId, p.baseUnitId),
    qty,
    factor: lineFactorOf(p, unitId),
    fallbackTierId,
  };
  const r = priceForQty(input);
  return { ...r, hint: nextRungHint(input), hasLadder: ladderOf(p.qtyTiers, input.unitKey).length >= 2, factor: input.factor };
}
