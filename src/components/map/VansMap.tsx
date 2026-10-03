"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type VanMark = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  status: "online" | "stale" | "offline";
  statusLabel: string;
  driver: string | null;
  seenLabel: string;
};

const STATUS_COLOR = {
  online: "#10b981",
  stale: "#f59e0b",
  offline: "#9ca3af",
} as const;

function vanIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45)">🚚</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function FitBounds({ marks }: { marks: VanMark[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = marks.filter((m) => m.lat != null && m.lng != null) as Array<VanMark & { lat: number; lng: number }>;
    if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 13);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])).pad(0.2));
  }, [map, marks]);
  return null;
}

/// Live van positions on an offline-capable Leaflet map.
export function VansMap({ marks, height = 420 }: { marks: VanMark[]; height?: number | string }) {
  const icons = useMemo(() => {
    const cache = new Map<string, L.DivIcon>();
    return (status: VanMark["status"]) => {
      const hit = cache.get(status);
      if (hit) return hit;
      const icon = vanIcon(STATUS_COLOR[status]);
      cache.set(status, icon);
      return icon;
    };
  }, []);
  const withPos = marks.filter((m) => m.lat != null && m.lng != null);
  const center: [number, number] =
    withPos.length > 0 ? [withPos[0].lat as number, withPos[0].lng as number] : [36.75, 3.06]; // Algiers fallback
  return (
    <MapContainer center={center} zoom={11} style={{ height, width: "100%", borderRadius: 14, zIndex: 0 }} scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
      />
      <FitBounds marks={marks} />
      {withPos.map((m) => (
        <Marker key={m.id} position={[m.lat as number, m.lng as number]} icon={icons(m.status)}>
          <Tooltip direction="top" offset={[0, -18]}>
            <div style={{ fontWeight: 800 }}>{m.name}</div>
            {m.driver && <div>{m.driver}</div>}
            <div>
              {m.statusLabel} · {m.seenLabel}
            </div>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
