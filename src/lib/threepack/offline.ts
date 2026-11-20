/// 3pack on the van phone: everything is derived from the synced snapshot
/// (rules + each product's own conversions), so it works with no network.

import { colisOf, computeBonus, type ColisInfo, type GiftLine } from "@/lib/threepack/match";

type SnapProduct = { id: string; baseUnit: { id: string } | null; conversions: Array<{ unitId: string; factor: number }> };
type SnapLike = {
  products: SnapProduct[];
  threePack?: { enabled: boolean; rules: Parameters<typeof computeBonus>[0] };
} | null;

const cache = new WeakMap<object, Record<string, ColisInfo | undefined>>();

/// Colis unit/factor per product id, from the snapshot's conversions.
export function snapshotColis(snap: SnapLike): Record<string, ColisInfo | undefined> {
  if (!snap) return {};
  const hit = cache.get(snap);
  if (hit) return hit;
  const out: Record<string, ColisInfo | undefined> = {};
  for (const p of snap.products) {
    out[p.id] = colisOf({ baseUnitId: p.baseUnit?.id ?? null, conversions: p.conversions }) ?? undefined;
  }
  cache.set(snap, out);
  return out;
}

/// Gift lines owed for the purchased lines (qty in the line's own unit).
/// `baseQtyOf` turns a line into base units (uses the snapshot's conversions).
export function snapshotGifts(
  snap: SnapLike,
  lines: Array<{ productId: string; unitId?: string | null; qty: number; isBonus?: boolean }>,
  baseQtyOf: (productId: string, unitId: string | null | undefined, qty: number) => number,
): GiftLine[] {
  if (!snap?.threePack?.enabled || snap.threePack.rules.length === 0) return [];
  return computeBonus(
    snap.threePack.rules,
    lines.filter((l) => !l.isBonus).map((l) => ({ productId: l.productId, baseQty: baseQtyOf(l.productId, l.unitId, Number(l.qty)) })),
    snapshotColis(snap),
  );
}
