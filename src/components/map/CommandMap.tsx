"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { OfflineTiles } from "./ProximityMap";

export type CmdVan = {
  id: string; name: string; lat: number; lng: number;
  status: "online" | "stale" | "offline";
  statusLabel: string; driver: string | null; seenLabel: string;
};
export type CmdClient = { id: string; name: string; code: string; lat: number; lng: number; color: string };
export type CmdZonePin = { id: string; name: string; code: string; lat: number; lng: number; n: number };

const VAN_COLOR = { online: "#10b981", stale: "#f59e0b", offline: "#9ca3af" } as const;

// Icons are cached: a fresh divIcon per render makes Leaflet rebuild the marker
// DOM, which would kill the glide transition and restart the pulse ring.
const iconCache = new Map<string, L.DivIcon>();
function cached(key: string, make: () => L.DivIcon) {
  let i = iconCache.get(key);
  if (!i) { i = make(); iconCache.set(key, i); }
  return i;
}
function vanIcon(color: string, selected: boolean) {
  return cached(`van|${color}|${selected}`, () => {
    const ring = selected ? "0 0 0 4px rgba(37,99,235,.55)," : "";
    const pulse = color === VAN_COLOR.online ? `<span class="gw-van-ring" style="background:${color}"></span>` : "";
    return L.divIcon({
      className: "gw-van-marker",
      html: `<div style="position:relative;width:34px;height:34px">${pulse}<div style="position:relative;background:${color};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;border:3px solid #fff;box-shadow:${ring}0 2px 6px rgba(0,0,0,.45)">🚚</div></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  });
}
function pinIcon(n: number, selected: boolean) {
  return cached(`pin|${n}|${selected}`, () =>
    L.divIcon({
      className: "",
      html: `<div class="gw-pin-drop" style="background:${selected ? "#2563eb" : "#c9951a"};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${n}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    })
  );
}

function Focus({ points, nonce }: { points: Array<[number, number]>; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 16 });
    else if (points.length === 1) map.setView(points[0], 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, nonce]);
  return null;
}

/// Admin command map — three independent layers on one offline-capable map:
/// vans (live status), clients (dots, any colour) and numbered zone pins, plus
/// an optional van↔client link line for the current selection.
export function CommandMap({
  vans, clients, zonePins, showVans, showClients, showZone,
  selectedClientId, selectedVanId, link, trail, focus, nonce, height = "100%",
  onPickClient, onPickVan,
}: {
  vans: CmdVan[];
  clients: CmdClient[];
  zonePins: CmdZonePin[];
  showVans: boolean;
  showClients: boolean;
  showZone: boolean;
  selectedClientId: string | null;
  selectedVanId: string | null;
  link: [[number, number], [number, number]] | null;
  /// The selected van's trail for the chosen day (oldest → newest).
  trail?: Array<[number, number]> | null;
  focus: Array<[number, number]>;
  nonce: number;
  height?: number | string;
  onPickClient?: (id: string) => void;
  onPickVan?: (id: string) => void;
}) {
  const allPts = useMemo(() => focus, [focus]);
  const center: [number, number] = allPts[0] ?? [36.75, 3.06];
  const tilePins = useMemo(
    () => clients.slice(0, 600).map((c) => ({ id: c.id, name: c.name, code: c.code, lat: c.lat, lng: c.lng, prox: "none" as const })),
    [clients]
  );
  return (
    <MapContainer center={center} zoom={11} style={{ height, width: "100%", borderRadius: 16, zIndex: 0 }} scrollWheelZoom>
      <OfflineTiles pins={tilePins} />
      <Focus points={allPts} nonce={nonce} />
      {showClients && clients.map((c) => (
        <CircleMarker
          key={c.id}
          center={[c.lat, c.lng]}
          radius={c.id === selectedClientId ? 11 : 7}
          pathOptions={{ color: c.id === selectedClientId ? "#2563eb" : "#fff", weight: c.id === selectedClientId ? 3 : 2, fillColor: c.color, fillOpacity: 0.95 }}
          eventHandlers={onPickClient ? { click: () => onPickClient(c.id) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <b>{c.name}</b><br /><span style={{ fontFamily: "monospace" }} dir="ltr">{c.code}</span>
          </Tooltip>
        </CircleMarker>
      ))}
      {showZone && zonePins.map((p) => (
        <Marker
          key={`z${p.id}`}
          position={[p.lat, p.lng]}
          icon={pinIcon(p.n, p.id === selectedClientId)}
          eventHandlers={onPickClient ? { click: () => onPickClient(p.id) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -14]}>
            <b>{p.n}. {p.name}</b><br /><span style={{ fontFamily: "monospace" }} dir="ltr">{p.code}</span>
          </Tooltip>
        </Marker>
      ))}
      {trail && trail.length > 1 && (
        <>
          <Polyline positions={trail} pathOptions={{ color: "#ea580c", weight: 4, opacity: 0.85 }} />
          <CircleMarker center={trail[0]} radius={6} pathOptions={{ color: "#fff", weight: 2, fillColor: "#16a34a", fillOpacity: 1 }} />
        </>
      )}
      {link && <Polyline positions={link} pathOptions={{ color: "#2563eb", weight: 3, dashArray: "6 6" }} />}
      {showVans && vans.map((v) => (
        <Marker
          key={v.id}
          position={[v.lat, v.lng]}
          icon={vanIcon(VAN_COLOR[v.status], v.id === selectedVanId)}
          eventHandlers={onPickVan ? { click: () => onPickVan(v.id) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -18]}>
            <div style={{ fontWeight: 800 }}>{v.name}</div>
            {v.driver && <div>{v.driver}</div>}
            <div>{v.statusLabel} · {v.seenLabel}</div>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
