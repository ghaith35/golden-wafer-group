/// Pure GPS math + road routing — no React, safe to import anywhere
/// (API routes, seed scripts, client components).

export type LatLng = { lat: number; lng: number };

/** City-van average speed — fallback estimate when routing is offline. */
export const AVG_KMH = 30;

/** Max waypoints per OSRM demo request (fair-use cap). */
const OSRM_MAX = 100;

/** Haversine distance in meters between two GPS points. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** "350 م" / "2.3 كم" style formatting. Returns null when coords missing. */
export function formatDist(
  from: LatLng | null,
  lat: unknown,
  lng: unknown,
  unitM: string,
  unitKm: string
): string | null {
  if (!from || lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const m = haversineM(from.lat, from.lng, la, ln);
  return m < 1000 ? `${Math.round(m)} ${unitM}` : `${(m / 1000).toFixed(1)} ${unitKm}`;
}

export function formatMeters(m: number, unitM: string, unitKm: string): string {
  return m < 1000 ? `${Math.round(m)} ${unitM}` : `${(m / 1000).toFixed(1)} ${unitKm}`;
}

export function formatSeconds(s: number, unitMin: string): string {
  return `${Math.max(1, Math.round(s / 60))} ${unitMin}`;
}

/** Rough drive-time estimate at city speed (offline fallback path). */
export function formatTime(from: LatLng | null, lat: unknown, lng: unknown, unitMin: string): string | null {
  if (!from || lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const minutes = Math.max(1, Math.round(haversineM(from.lat, from.lng, la, ln) / ((AVG_KMH * 1000) / 60)));
  return `≈ ${minutes} ${unitMin}`;
}

/** Parse "lat, lng" typed by hand (offline / denied-GPS fallback). */
export function parseLatLng(raw: string): LatLng | null {
  const m = raw.trim().match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export type RoutePoint = { id: string; lat: number; lng: number };

/// Real road distance + drive time from the free OSRM router (no key).
/// One batched request for all points; nulls where unroutable/offline.
export async function fetchRouteMatrix(
  from: LatLng,
  points: RoutePoint[]
): Promise<Array<{ distM: number; durS: number } | null> | null> {
  const pts = points.slice(0, OSRM_MAX);
  if (pts.length === 0) return [];
  const coords = [from, ...pts].map((p) => `${p.lng},${p.lat}`).join(";");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(
      `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code !== "Ok" || !Array.isArray(data.durations?.[0])) return null;
    const durs = data.durations[0] as Array<number | null>;
    const dists = Array.isArray(data.distances?.[0]) ? (data.distances[0] as Array<number | null>) : [];
    return pts.map((_, i) => {
      const dur = durs[i + 1];
      const dist = dists[i + 1];
      return typeof dur === "number" && typeof dist === "number" ? { distM: dist, durS: dur } : null;
    });
  } catch {
    return null;
  }
}

/// Road-first computation for many clients: OSRM matrix, per-point
/// Haversine fallback wherever the router has no answer.
export async function computeTrips(
  from: LatLng,
  points: RoutePoint[]
): Promise<Array<{ id: string; distM: number; durS: number; source: "osrm" | "estimate" }>> {
  const road = await fetchRouteMatrix(from, points);
  return points.slice(0, OSRM_MAX).map((p, i) => {
    const r = road?.[i];
    if (r) return { id: p.id, distM: r.distM, durS: r.durS, source: "osrm" as const };
    const m = haversineM(from.lat, from.lng, p.lat, p.lng);
    return { id: p.id, distM: m, durS: (m / 1000 / AVG_KMH) * 3600, source: "estimate" as const };
  });
}
