import { ladderOf, type QtyRung } from "@/lib/pricing";

/// Normalise a ladder payload before it is stored:
///  · only the base unit ("") or a colisage the product really has
///  · one rung per minQty, ascending
///  · a ladder needs at least 2 rungs (a single rung would just be a tier
///    override — use the client tier for that)
export function sanitizeQtyTiers(input: Array<QtyRung> | null | undefined, allowedUnitKeys: Iterable<string>): QtyRung[] {
  const allowed = new Set<string>(["", ...allowedUnitKeys]);
  const keys = [...new Set((input ?? []).map((r) => r.unitKey ?? ""))].filter((k) => allowed.has(k));
  const out: QtyRung[] = [];
  for (const k of keys) {
    const ladder = ladderOf(input, k);
    if (ladder.length >= 2) out.push(...ladder);
  }
  return out;
}
