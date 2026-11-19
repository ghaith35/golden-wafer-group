"use client";

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { tileLayerOffline, savetiles } from "leaflet.offline";
import "leaflet/dist/leaflet.css";

export type MapStop = {
  id: string;
  name: string;
  code: string;
  lat: number | null;
  lng: number | null;
  position: number;
  state: "pending" | "visited" | "sold" | "skipped";
};

const STATE_COLOR: Record<MapStop["state"], string> = {
  pending: "#c9951a",
  visited: "#10b981",
  sold: "#059669",
  skipped: "#ef4444",
};

function numberedIcon(n: number, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function OfflineLayer({ saveTiles }: { saveTiles: boolean }) {
  const map = useMap();
  useEffect(() => {
    const layer = tileLayerOffline("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      subdomains: "abc",
      minZoom: 5,
      maxZoom: 19,
      crossOrigin: true,
    });
    layer.addTo(map);
    let control: L.Control | null = null;
    if (saveTiles) {
      control = savetiles(layer as never, { zoomlevels: [12, 13, 14, 15, 16], confirm: null, confirmRemoval: null });
      control.addTo(map);
    }
    return () => {
      try { if (control) map.removeControl(control); } catch { /* noop */ }
      try { map.removeLayer(layer); } catch { /* noop */ }
    };
  }, [map, saveTiles]);
  return null;
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.15));
    else if (points.length === 1) map.setView(points[0], 14);
  }, [map, points]);
  return null;
}

function VendeurDot({ follow }: { follow: boolean }) {
  const map = useMap();
  const [pos, setPos] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const ll: [number, number] = [p.coords.latitude, p.coords.longitude];
        setPos(ll);
        if (follow) map.setView(ll, Math.max(map.getZoom(), 14));
      },
      () => {},
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [map, follow]);
  if (!pos) return null;
  return <CircleMarker center={pos} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: "#c9951a", fillOpacity: 1 }} />;
}

/// Shared secteur/tournée map: numbered pins in visit order, route polyline,
/// live vendeur dot, offline tile layer with save-zone control.
export function TourneeMap({
  stops,
  showRoute = true,
  followVendeur = false,
  saveTiles = false,
  height = 380,
  onStopClick,
}: {
  stops: MapStop[];
  showRoute?: boolean;
  followVendeur?: boolean;
  saveTiles?: boolean;
  height?: number | string;
  onStopClick?: (id: string) => void;
}) {
  const geo = useMemo(() => stops.filter((s) => s.lat != null && s.lng != null), [stops]);
  const ordered = useMemo(() => [...geo].sort((a, b) => a.position - b.position), [geo]);
  const points = ordered.map((s) => [s.lat!, s.lng!] as [number, number]);
  const center: [number, number] = points[0] ?? [36.75, 3.06]; // Algiers fallback

  return (
    <MapContainer center={center} zoom={12} style={{ height, width: "100%", borderRadius: 14, zIndex: 0 }} scrollWheelZoom={false}>
      <OfflineLayer saveTiles={saveTiles} />
      <FitBounds points={points} />
      {ordered.map((s, i) => (
        <Marker
          key={s.id}
          position={[s.lat!, s.lng!]}
          icon={numberedIcon(i + 1, STATE_COLOR[s.state])}
          eventHandlers={onStopClick ? { click: () => onStopClick(s.id) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -14]}>
            <b>{i + 1}. {s.name}</b>
            <br />
            <span style={{ fontFamily: "monospace" }} dir="ltr">{s.code}</span>
          </Tooltip>
        </Marker>
      ))}
      {showRoute && points.length > 1 && <Polyline positions={points} pathOptions={{ color: "#059669", weight: 3, dashArray: "6 6" }} />}
      <VendeurDot follow={followVendeur} />
    </MapContainer>
  );
}
