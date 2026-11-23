"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { tileLayerOffline, getTilePoints, getTileUrl, hasTile, downloadTile, saveTile } from "leaflet.offline";
import "leaflet/dist/leaflet.css";
import { PROX_HEX, type Proximity } from "@/lib/proximity";

export type ProxPin = { id: string; name: string; code: string; lat: number; lng: number; prox: Proximity };

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
/// Hard cap per visit so caching never hogs the phone's storage or data.
const MAX_AUTO_TILES = 400;

/// Offline tile layer (IndexedDB-backed: already-seen tiles render with no
/// network) + automatic background caching of the tiles around the pins, so
/// the map the driver opens in the office is still there in the field.
function OfflineTiles({ pins }: { pins: ProxPin[] }) {
  const map = useMap();
  useEffect(() => {
    const layer = tileLayerOffline(TILE_URL, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      subdomains: "abc",
      minZoom: 5,
      maxZoom: 19,
      crossOrigin: true,
    });
    layer.addTo(map);
    return () => {
      try { map.removeLayer(layer); } catch { /* noop */ }
    };
  }, [map]);

  useEffect(() => {
    if (pins.length === 0 || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    let cancelled = false;
    void (async () => {
      try {
        const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])).pad(0.1);
        const tileSize = L.point(256, 256);
        let n = 0;
        // Wide→close zooms around the pins; stops at the cap.
        for (const z of [12, 13, 14, 15, 16]) {
          const nw = map.project(bounds.getNorthWest(), z);
          const se = map.project(bounds.getSouthEast(), z);
          const pts = getTilePoints(L.bounds(nw, se), tileSize);
          for (const pt of pts) {
            if (cancelled || n >= MAX_AUTO_TILES) return;
            // Same key the tile layer reads: first subdomain ("a").
            const url = getTileUrl(TILE_URL, { s: "a", x: pt.x, y: pt.y, z });
            const key = url;
            if (await hasTile(key).catch(() => false)) continue;
            try {
              const blob = await downloadTile(url);
              await saveTile({ key, url, urlTemplate: TILE_URL, x: pt.x, y: pt.y, z, createdAt: Date.now() } as never, blob);
              n++;
            } catch {
              /* skip the tile; offline mid-way is fine */
            }
          }
        }
      } catch {
        /* caching is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the set of pins changes meaningfully.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pins.length]);
  return null;
}

function Fit({ pins, me, nonce }: { pins: ProxPin[]; me: [number, number] | null; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    const pts = pins.map((p) => [p.lat, p.lng] as [number, number]);
    if (me) pts.push(me);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16 });
    else if (pts.length === 1) map.setView(pts[0], 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pins.map((p) => p.id).join(","), nonce]);
  return null;
}

/// Phone-first map: colour-coded client dots (green near · orange far ·
/// red very far) + the driver's own position. Fully usable offline.
export function ProximityMap({
  pins,
  me,
  height = 320,
  nonce = 0,
  onPick,
}: {
  pins: ProxPin[];
  me: { lat: number; lng: number } | null;
  height?: number | string;
  /// Bump to re-fit the view (filter change / refresh).
  nonce?: number;
  onPick?: (id: string) => void;
}) {
  const meLL = useMemo<[number, number] | null>(() => (me ? [me.lat, me.lng] : null), [me]);
  const center: [number, number] = meLL ?? (pins[0] ? [pins[0].lat, pins[0].lng] : [36.75, 3.06]);
  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height, width: "100%", borderRadius: 16, zIndex: 0 }}
      scrollWheelZoom={false}
    >
      <OfflineTiles pins={pins} />
      <Fit pins={pins} me={meLL} nonce={nonce} />
      {pins.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={9}
          pathOptions={{ color: "#fff", weight: 2, fillColor: PROX_HEX[p.prox], fillOpacity: 1 }}
          eventHandlers={onPick ? { click: () => onPick(p.id) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            <b>{p.name}</b>
            <br />
            <span style={{ fontFamily: "monospace" }} dir="ltr">{p.code}</span>
          </Tooltip>
        </CircleMarker>
      ))}
      {meLL && (
        <CircleMarker
          center={meLL}
          radius={8}
          pathOptions={{ color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}
        />
      )}
    </MapContainer>
  );
}
