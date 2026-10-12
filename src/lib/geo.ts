import { useCallback, useEffect, useState } from "react";
import {
  haversineM, formatMeters, formatSeconds, formatTime, parseLatLng,
  fetchRouteMatrix, AVG_KMH,
  type LatLng, type RoutePoint,
} from "./geo-math";

export type { LatLng, RoutePoint };
export { haversineM, formatMeters, formatSeconds, formatTime, parseLatLng, fetchRouteMatrix, AVG_KMH };
export { formatDist } from "./geo-math";

/** One-shot device position (button-triggered, high accuracy). */
export function useLivePosition() {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeoError(true);
      return;
    }
    setLocating(true);
    setGeoError(false);
    const done = (lat: number, lng: number) => {
      setPos({ lat, lng });
      setLocating(false);
    };
    const fail = () => {
      setGeoError(true);
      setLocating(false);
    };
    const onError = (highAccuracy: boolean) => (e: GeolocationPositionError) => {
      // High accuracy fails indoors / on weak GPS — retry with any fix
      // before giving up (error code 2 = unavailable, 3 = timeout).
      if (highAccuracy && (e.code === 2 || e.code === 3)) {
        navigator.geolocation.getCurrentPosition(
          (p) => done(p.coords.latitude, p.coords.longitude),
          () => fail(),
          { enableHighAccuracy: false, timeout: 15000 }
        );
      } else {
        fail();
      }
    };
    navigator.geolocation.getCurrentPosition(
      (p) => done(p.coords.latitude, p.coords.longitude),
      onError(true),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  /** Manual fallback (GPS denied / desktop app without location service). */
  const setManual = useCallback((raw: string): boolean => {
    const p = parseLatLng(raw);
    if (!p) return false;
    setGeoError(false);
    setPos(p);
    return true;
  }, []);

  return { pos, locating, geoError, locate, setManual };
}

/** Per-client "dist · time" map: instant Haversine estimate, upgraded to
 * real road data when the router answers (silent offline fallback). */
export function useTripMeta(  pos: LatLng | null,
  points: RoutePoint[],
  units: { unitM: string; unitKm: string; unitMin: string }
): Map<string, string | null> {
  const [map, setMap] = useState<Map<string, string | null>>(new Map());
  const key = pos ? `${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}|${points.map((p) => p.id).join(",")}` : "";

  useEffect(() => {
    if (!pos || points.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    const fallback = new Map<string, string | null>(
      points.map((p) => {
        const m = haversineM(pos.lat, pos.lng, p.lat, p.lng);
        return [p.id, `${formatMeters(m, units.unitM, units.unitKm)} · ≈ ${formatSeconds((m / 1000 / AVG_KMH) * 3600, units.unitMin)}`];
      })
    );
    setMap(fallback);
    void (async () => {
      const road = await fetchRouteMatrix(pos, points);
      if (cancelled || !road) return;
      const next = new Map<string, string | null>();
      points.forEach((p, i) => {
        const r = road[i];
        next.set(p.id, r ? `${formatMeters(r.distM, units.unitM, units.unitKm)} · ${formatSeconds(r.durS, units.unitMin)}` : fallback.get(p.id) ?? null);
      });
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

export type TripUnits = { unitM: string; unitKm: string; unitMin: string };


/// Silence dnd-kit screen-reader announcements (their live region paints
/// visibly in some builds). Drag behavior is unchanged.
export const SILENT_A11Y = {
  announcements: {
    onDragStart: () => "",
    onDragMove: () => "",
    onDragOver: () => "",
    onDragEnd: () => "",
    onDragCancel: () => "",
  },
};

/// Consecutive legs for an ordered visit list: points[0] is the start
/// (usually the live position), legs[i] = points[i] -> points[i+1].
/// Single batched OSRM call; per-leg Haversine fallback.
export async function fetchRouteLegs(
  points: LatLng[]
): Promise<Array<{ distM: number; durS: number } | null> | null> {
  if (points.length < 2) return [];
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const idx = points.map((_, i) => i);
  const src = idx.slice(0, -1).join(";");
  const dst = idx.slice(1).join(";");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(
      `https://router.project-osrm.org/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration,distance`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code !== "Ok" || !Array.isArray(data.durations)) return null;
    return idx.slice(0, -1).map((_, i) => {
      const row = data.durations[i] as Array<number | null> | undefined;
      const drow = Array.isArray(data.distances) ? (data.distances[i] as Array<number | null> | undefined) : undefined;
      const dur = row?.[i];
      const dist = drow?.[i];
      return typeof dur === "number" && typeof dist === "number" ? { distM: dist, durS: dur } : null;
    });
  } catch {
    return null;
  }
}

function legFallback(a: LatLng, b: LatLng): { distM: number; durS: number } {
  const m = haversineM(a.lat, a.lng, b.lat, b.lng);
  return { distM: m, durS: (m / 1000 / AVG_KMH) * 3600 };
}

/** Chained tour legs for an ordered stop list: per-stop "dist · time" from
 * the previous point plus whole-tour totals. Instant estimate, upgraded to
 * road data; recomputes on every reorder. With persist, the fresh position
 * is also saved to the per-user snapshot. */
export function useTourLegs(
  pos: LatLng | null,
  stops: RoutePoint[],
  units: { unitM: string; unitKm: string; unitMin: string },
  opts?: { persist?: boolean }
): { meta: Map<string, string | null>; total: string | null } {
  const [state, setState] = useState<{ meta: Map<string, string | null>; total: string | null }>({
    meta: new Map(),
    total: null,
  });
  const key = pos
    ? `${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}|${stops.map((s) => s.id).join(",")}`
    : "";

  useEffect(() => {
    if (!pos || stops.length === 0) {
      setState({ meta: new Map(), total: null });
      return;
    }
    let cancelled = false;
    if (opts?.persist) {
      void fetch("/api/distances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng }),
      }).catch(() => {});
    }
    const pts = [pos, ...stops];
    const apply = (legs: Array<{ distM: number; durS: number }>) => {
      const meta = new Map<string, string | null>();
      let totalM = 0;
      let totalS = 0;
      stops.forEach((s, i) => {
        const leg = legs[i];
        totalM += leg.distM;
        totalS += leg.durS;
        meta.set(s.id, `${formatMeters(leg.distM, units.unitM, units.unitKm)} · ${formatSeconds(leg.durS, units.unitMin)}`);
      });
      setState({
        meta,
        total: `${formatMeters(totalM, units.unitM, units.unitKm)} · ${formatSeconds(totalS, units.unitMin)}`,
      });
    };
    apply(pts.slice(0, -1).map((_, i) => legFallback(pts[i], pts[i + 1])));
    void (async () => {
      const road = await fetchRouteLegs(pts);
      if (cancelled || !road) return;
      const legs = pts.slice(0, -1).map((_, i) => road[i] ?? legFallback(pts[i], pts[i + 1]));
      apply(legs);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** Database-backed per-user distances: loads the user's last snapshot on
/** Database-backed per-user distances: loads the user's last snapshot on
 * open; `refresh` recomputes from a position, persists, and redisplays. */
export function useSavedDistances(units: TripUnits) {
  const [meta, setMeta] = useState<Map<string, string | null>>(new Map());
  const [raw, setRaw] = useState<Map<string, { distM: number; durS: number }>>(new Map());
  const [pos, setPos] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);

  const formatRows = useCallback(
    (rows: Array<{ clientId: string; distM: number; durS: number }>) =>
      new Map(rows.map((r) => [r.clientId, `${formatMeters(r.distM, units.unitM, units.unitKm)} · ${formatSeconds(r.durS, units.unitMin)}`] as [string, string])),
    [units.unitM, units.unitKm, units.unitMin]
  );

  useEffect(() => {
    fetch("/api/distances")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => {
        setMeta(formatRows(d.rows ?? []));
        setRaw(new Map((d.rows ?? []).map((r: { clientId: string; distM: number; durS: number }) => [r.clientId, { distM: Number(r.distM), durS: Number(r.durS) }])));
      })
      .catch(() => {});
  }, [formatRows]);

  const refresh = useCallback(
    async (lat: number, lng: number): Promise<boolean> => {
      setLocating(true);
      setGeoError(false);
      try {
        const res = await fetch("/api/distances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
        if (!res.ok) throw new Error("save_failed");
        const data = await res.json();
        setMeta(formatRows(data.rows ?? []));
        setRaw(new Map((data.rows ?? []).map((r: { clientId: string; distM: number; durS: number }) => [r.clientId, { distM: Number(r.distM), durS: Number(r.durS) }])));
        return true;
      } catch {
        // Offline (or server down): the GPS fix itself is still valid — keep
        // the last-good distances and don't cry "GPS denied" at the driver.
        try {
          if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
        } catch {
          return false;
        }
        setGeoError(true);
        return false;
      } finally {
        setLocating(false);
      }
    },
    [formatRows]
  );

  const locate = useCallback(
    (done?: (pos: LatLng) => void) => {
      if (!("geolocation" in navigator)) {
        setGeoError(true);
        return;
      }
      setLocating(true);
      setGeoError(false);
      const apply = (lat: number, lng: number) => {
        setPos({ lat, lng });
        done?.({ lat, lng });
        void refresh(lat, lng);
      };
      const fail = () => {
        setGeoError(true);
        setLocating(false);
      };
      const onError = (highAccuracy: boolean) => (e: GeolocationPositionError) => {
        if (highAccuracy && (e.code === 2 || e.code === 3)) {
          navigator.geolocation.getCurrentPosition(
            (p) => apply(p.coords.latitude, p.coords.longitude),
            () => fail(),
            { enableHighAccuracy: false, timeout: 15000 }
          );
        } else {
          fail();
        }
      };
      navigator.geolocation.getCurrentPosition(
        (p) => apply(p.coords.latitude, p.coords.longitude),
        onError(true),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    },
    [refresh]
  );

  const setManual = useCallback(
    (raw: string): boolean => {
      const p = parseLatLng(raw);
      if (!p) return false;
      setGeoError(false);
      setPos(p);
      void refresh(p.lat, p.lng);
      return true;
    },
    [refresh]
  );

  return { meta: (id: string): string | null => meta.get(id) ?? null, raw, pos, locating, geoError, locate, setManual };
}

/** Chained Haversine totals for a stop list from a start point (instant,
 * no network) — used for day-column footers. */
export function chainTotals(
  from: LatLng | null,
  stops: Array<{ lat: number; lng: number }>,
  units: { unitM: string; unitKm: string; unitMin: string }
): string | null {
  if (!from || stops.length === 0) return null;
  let totalM = 0;
  let prev = from;
  for (const s of stops) {
    totalM += haversineM(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }
  const totalS = (totalM / 1000 / AVG_KMH) * 3600;
  return `${formatMeters(totalM, units.unitM, units.unitKm)} · ${formatSeconds(totalS, units.unitMin)}`;
}
