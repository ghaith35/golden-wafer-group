/// Closest-first ordering for client lists (van day list, GPS list).
/// Pure + unit-tested: the components only supply the anchor position
/// (live GPS, else the saved fix) and the last synced road distances.
///
/// Priority per row: live straight-line distance → saved road distance →
/// no position (keeps its relative order at the end, so tour order and
/// clients without GPS never jump around).
import { haversineM } from "@/lib/geo-math";

export type ProxRow = { id: string; gpsLat: unknown; gpsLng: unknown };
export type Anchor = { lat: number; lng: number } | null;

export function rowDistM(
  row: ProxRow,
  anchor: Anchor,
  roadDist: (id: string) => number | null | undefined,
): number | null {
  try {
    if (row.gpsLat != null && row.gpsLng != null && anchor) {
      const m = haversineM(anchor.lat, anchor.lng, Number(row.gpsLat), Number(row.gpsLng));
      if (Number.isFinite(m)) return m;
    }
  } catch {
    /* fall through to the saved road distance */
  }
  const road = roadDist(row.id);
  return typeof road === "number" && Number.isFinite(road) ? road : null;
}

/// Stable: rows without a distance keep their incoming order, after the
/// ones with a distance (nearest first).
export function sortClosestFirst<T extends ProxRow>(
  rows: T[],
  anchor: Anchor,
  roadDist: (id: string) => number | null | undefined,
): T[] {
  const withIdx = rows.map((r, i) => ({ r, i, d: rowDistM(r, anchor, roadDist) }));
  withIdx.sort((a, b) => {
    if (a.d == null && b.d == null) return a.i - b.i;
    if (a.d == null) return 1;
    if (b.d == null) return -1;
    return a.d === b.d ? a.i - b.i : a.d - b.d;
  });
  return withIdx.map((x) => x.r);
}
