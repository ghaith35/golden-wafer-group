/// Client proximity buckets — pure, offline (straight-line distance from the
/// phone's own GPS fix, no network). Shared by the GPS map and client cards.
export type Proximity = "near" | "mid" | "far" | "none";

/// ≤ NEAR_M → green · ≤ MID_M → orange · beyond → red · no GPS → neutral.
export const NEAR_M = 1000;
export const MID_M = 5000;

export function proximityOf(distM: number | null | undefined): Proximity {
  if (distM == null || !Number.isFinite(distM)) return "none";
  return distM <= NEAR_M ? "near" : distM <= MID_M ? "mid" : "far";
}

export const PROX_HEX: Record<Proximity, string> = {
  near: "#10b981",
  mid: "#f59e0b",
  far: "#ef4444",
  none: "#9ca3af",
};

/// Card tint (border + soft background) per bucket.
export const PROX_CARD: Record<Proximity, string> = {
  near: "border-emerald-500/60 bg-emerald-500/10",
  mid: "border-amber-500/60 bg-amber-500/10",
  far: "border-red-500/60 bg-red-500/10",
  none: "border-(--border-default) bg-(--bg-overlay)",
};
