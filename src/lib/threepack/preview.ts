/// Live "what the client gets" preview for the rule builder. PURE — it runs the
/// real matcher (`computeBonus`) in plain colis (factor 1), so the preview can
/// never disagree with what a sale will actually do.

import { computeBonus, type ColisInfo, type ThreePackRuleLite } from "@/lib/threepack/match";

export type PreviewItem = { productId: string; colis: number };

const PLAIN: ColisInfo = { unitId: null, factor: 1 };

/// Free colis a client earns for the given purchases (colis per product).
export function simulateGifts(buys: PreviewItem[], gives: PreviewItem[], bought: Record<string, number>): PreviewItem[] {
  const b = buys.filter((i) => i.productId && i.colis > 0);
  const g = gives.filter((i) => i.productId && i.colis > 0);
  if (b.length === 0 || g.length === 0) return [];
  const rule: ThreePackRuleLite = {
    id: "preview",
    name: "preview",
    mode: "PACK",
    isActive: true,
    items: [...b.map((i) => ({ role: "BUY" as const, ...i })), ...g.map((i) => ({ role: "GIVE" as const, ...i }))],
  };
  const colis: Record<string, ColisInfo> = {};
  for (const i of [...b, ...g]) colis[i.productId] = PLAIN;
  const lines = Object.entries(bought).map(([productId, qty]) => ({ productId, baseQty: qty }));
  return computeBonus([rule], lines, colis).map((x) => ({ productId: x.productId, colis: x.colis }));
}

/// A client who buys the whole combo `times` times.
export function boughtForCombos(buys: PreviewItem[], times: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of buys) if (i.productId && i.colis > 0) out[i.productId] = (out[i.productId] ?? 0) + i.colis * times;
  return out;
}
