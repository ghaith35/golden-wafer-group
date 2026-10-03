/// Offline route optimizer: nearest-neighbor + 2-opt over haversine distances.
/// No API, no cost, runs on-device. Stops without GPS keep trailing order.

export type GeoPoint = { id: string; lat: number | null; lng: number | null };

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function nearestNeighbor<T extends GeoPoint>(points: T[], start: { lat: number; lng: number }): T[] {
  const rest = [...points];
  const order: T[] = [];
  let cur = start;
  while (rest.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = haversineKm(cur.lat, cur.lng, rest[i].lat!, rest[i].lng!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const [next] = rest.splice(best, 1);
    order.push(next);
    cur = { lat: next.lat!, lng: next.lng! };
  }
  return order;
}

function tourLength(order: GeoPoint[], start: { lat: number; lng: number }): number {
  let total = 0;
  let cur = start;
  for (const p of order) {
    total += haversineKm(cur.lat, cur.lng, p.lat!, p.lng!);
    cur = { lat: p.lat!, lng: p.lng! };
  }
  return total;
}

function twoOpt<T extends GeoPoint>(order: T[], start: { lat: number; lng: number }): T[] {
  let best = [...order];
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (tourLength(cand, start) < tourLength(best, start) - 1e-9) {
          best = cand;
          improved = true;
        }
      }
    }
  }
  return best;
}

/// Returns stop ids in optimized visit order. GPS-less stops trail in input order.
export function optimizeRoute<T extends GeoPoint>(stops: T[], start: { lat: number; lng: number } | null): string[] {
  const geo = stops.filter((s) => s.lat != null && s.lng != null);
  const plain = stops.filter((s) => s.lat == null || s.lng == null);
  if (!geo.length || !start) return stops.map((s) => s.id);
  const ordered = twoOpt(nearestNeighbor(geo, start), start);
  return [...ordered.map((s) => s.id), ...plain.map((s) => s.id)];
}
