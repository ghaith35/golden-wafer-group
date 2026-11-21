"use client";

import { useMemo, useState } from "react";
import { MapPin, ChevronRight, ChevronLeft, Route } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { ClientName } from "@/components/clients/ClientName";
import { matchClient } from "@/lib/clients/display";
import dynamic from "next/dynamic";
import type { MapStop } from "@/components/map/TourneeMap";

// Leaflet touches `window` at import time — it can only load in the browser.
// Dynamic ssr:false keeps server rendering (and the whole page) working.
// (Temporary bridge while the offline-map work lands; do not convert back
// to a static import.)
const TourneeMap = dynamic(
  () => import("@/components/map/TourneeMap").then((m) => m.TourneeMap),
  { ssr: false, loading: () => <p className="p-6 text-center text-sm opacity-60">…</p> }
);

type GpsClient = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  gpsLat: number;
  gpsLng: number;
  secteur: { name: string } | null;
  wilaya: { code: number; nameAr: string } | null;
};

type Mode = "client" | "wilaya" | "secteur";

/// Zone browser: pick a client, a wilaya, or a secteur — selecting a zone
/// lists every geolocated client in it, steps through them on the map, and
/// can open the whole tour in Google Maps (universal URL, no API key).
export function CarteClient({
  initial,
  secteurs,
  labels,
}: {
  initial: GpsClient[];
  secteurs: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
}) {
  const [mode, setMode] = useState<Mode>("client");
  const [q, setQ] = useState("");
  // Drill-down zone: null = zone list, set = clients of that zone.
  const [zoneWilaya, setZoneWilaya] = useState<number | null>(null);
  const [zoneSecteur, setZoneSecteur] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);

  const wilayas = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of initial) {
      if (c.wilaya && !map.has(c.wilaya.code)) map.set(c.wilaya.code, c.wilaya.nameAr);
    }
    return [...map.entries()]
      .map(([code, nameAr]) => ({ code, nameAr, count: initial.filter((c) => c.wilaya?.code === code).length }))
      .sort((a, b) => a.code - b.code);
  }, [initial]);

  const zoneSecteurs = useMemo(
    () =>
      secteurs.map((s) => ({
        ...s,
        count: initial.filter((c) => c.secteur?.name === s.name).length,
      })),
    [initial, secteurs]
  );

  const filtered = useMemo(() => {
    let rows = initial;
    if (mode === "wilaya" && zoneWilaya != null) rows = rows.filter((c) => c.wilaya?.code === zoneWilaya);
    if (mode === "secteur" && zoneSecteur != null) {
      const name = secteurs.find((s) => s.id === zoneSecteur)?.name;
      rows = rows.filter((c) => c.secteur?.name === name);
    }
    if (mode === "client" && q) {
      rows = rows.filter((c) => matchClient(q, c));
    }
    return rows;
  }, [initial, mode, q, zoneWilaya, zoneSecteur, secteurs]);

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;
  const selIndex = selected ? filtered.findIndex((c) => c.id === selected.id) : -1;
  const step = (dir: 1 | -1) => {
    if (filtered.length === 0) return;
    const next = (selIndex + dir + filtered.length) % filtered.length;
    setSelectedId(filtered[next].id);
  };

  const embed = selected
    ? `https://www.google.com/maps?q=${selected.gpsLat},${selected.gpsLng}&z=15&output=embed`
    : null;
  // Zone tapped → every client as a numbered pin (Leaflet, no key needed).
  const zoneTapped = mode !== "client" && (zoneWilaya != null || zoneSecteur != null);
  const zoneStops: MapStop[] = zoneTapped
    ? filtered.map((c, i) => ({ id: c.id, name: c.name, code: c.code, lat: c.gpsLat, lng: c.gpsLng, position: i, state: "pending" as const }))
    : [];
  const zoneLabel =
    mode === "wilaya"
      ? (wilayas.find((w) => w.code === zoneWilaya)?.nameAr ?? labels.tabWilaya)
      : mode === "secteur"
        ? (secteurs.find((s) => s.id === zoneSecteur)?.name ?? labels.tabSecteur)
        : "";
  const external = selected ? `https://www.google.com/maps?q=${selected.gpsLat},${selected.gpsLng}` : null;
  // Whole zone as a Google Maps tour (origin → waypoints → destination).
  const tour =
    filtered.length > 1
      ? `https://www.google.com/maps/dir/?api=1&destination=${filtered[filtered.length - 1].gpsLat},${filtered[filtered.length - 1].gpsLng}&waypoints=${filtered
          .slice(0, -1)
          .slice(0, 9)
          .map((c) => `${c.gpsLat},${c.gpsLng}`)
          .join("%7C")}`
      : null;

  function switchMode(m: Mode) {
    setMode(m);
    setZoneWilaya(null);
    setZoneSecteur(null);
    setSelectedId(null);
  }

  return (
    <div className="flex h-[calc(var(--vh)-140px)] flex-col gap-3 overflow-hidden px-5 pb-24 pt-5 md:p-6 lg:h-[calc(var(--vh)-60px)]">
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {tour && (
          <a
            href={tour}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-(--brand-500)/10 px-3 py-2 text-xs font-bold text-(--brand-600)"
          >
            <Route size={14} />
            {labels.openTour} ({filtered.length}) ↗
          </a>
        )}
      </div>

      <div className="flex shrink-0 rounded-lg bg-(--bg-sunken) p-0.5" role="tablist">
        {(["client", "wilaya", "secteur"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-xs font-black transition-colors",
              mode === m ? "bg-(--bg-overlay) text-(--text-primary) shadow" : "text-(--text-secondary)"
            )}
          >
            {m === "client" ? labels.tabClient : m === "wilaya" ? labels.tabWilaya : labels.tabSecteur}
          </button>
        ))}
      </div>

      {mode === "client" && (
        <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} className="shrink-0" />
      )}

      {filtered.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[36dvh_minmax(0,1fr)] gap-3 md:grid-cols-[260px_1fr] md:grid-rows-1 lg:grid-cols-[320px_1fr]">
        <div className="order-2 min-h-0 space-y-2 overflow-y-auto md:order-1 md:h-full">
          {mode !== "client" && (
            <ZoneDrill
              mode={mode}
              wilayas={wilayas}
              secteurs={zoneSecteurs}
              zoneWilaya={zoneWilaya}
              zoneSecteur={zoneSecteur}
              onZone={(w, s) => {
                setZoneWilaya(w);
                setZoneSecteur(s);
                setSelectedId(null);
              }}
              labels={labels}
            />
          )}
          {mode !== "client" && (zoneWilaya != null || zoneSecteur != null) && (
            <p className="text-xs font-bold opacity-60">
              {mode === "wilaya"
                ? wilayas.find((w) => w.code === zoneWilaya)?.nameAr
                : zoneSecteurs.find((s) => s.id === zoneSecteur)?.name}
              {" · "}{labels.count}: {filtered.length}
            </p>
          )}
          {mode === "client" && (
            <p className="text-xs font-bold opacity-60">{labels.count}: {filtered.length}</p>
          )}
          {(mode === "client") && filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border p-3 text-start transition-colors",
                selected?.id === c.id
                  ? "border-(--brand-500) bg-(--brand-500)/5"
                  : "border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)"
              )}
            >
              <MapPin size={16} className={cn("shrink-0", selected?.id === c.id ? "text-(--brand-600)" : "opacity-50")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold"><ClientName name={c.name} lat={c.gpsLat} lng={c.gpsLng} /></span>
                <span className="block truncate text-xs opacity-60">
                  {c.code} {c.wilaya ? `· ${c.wilaya.code} ${c.wilaya.nameAr}` : ""} {c.secteur ? `· ${c.secteur.name}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="order-1 h-full min-h-0 md:order-2">
          {mode !== "client" && !zoneTapped ? (
            <p className="rounded-2xl border border-dashed border-(--border-default) p-6 text-center text-sm opacity-60">
              👆 {mode === "wilaya" ? labels.tabWilaya : labels.tabSecteur}
            </p>
          ) : zoneTapped ? (
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-(--border-default) px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">
                    {zoneLabel}{selected ? ` · ${selected.name}` : ""}
                  </div>
                  <div className="text-xs opacity-60">{labels.count}: {filtered.length}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {selected && (
                    <a
                      href={`https://www.google.com/maps?q=${selected.gpsLat},${selected.gpsLng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-xs font-bold"
                    >
                      {labels.openMaps} ↗
                    </a>
                  )}
                  {tour && (
                    <a
                      href={tour}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-(--brand-500)/10 px-3 py-1.5 text-xs font-bold text-(--brand-600)"
                    >
                      {labels.openTour} ↗
                    </a>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1">
              <TourneeMap
                key={`${mode}-${zoneWilaya}-${zoneSecteur}`}
                stops={zoneStops}
                showRoute={false}
                height="100%"
                onStopClick={(id) => setSelectedId(id)}
              />
              </div>
            </div>
          ) : selected && embed ? (
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
              <div className="flex shrink-0 items-center gap-2 border-b border-(--border-default) px-3 py-2.5">
                <button
                  type="button"
                  aria-label={labels.prev}
                  onClick={() => step(-1)}
                  disabled={filtered.length < 2}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) disabled:opacity-40 rtl:rotate-180"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{selected.name}</div>
                  <div className="truncate text-xs opacity-60">
                    {selIndex + 1} / {filtered.length} · <span className="font-mono" dir="ltr">{selected.gpsLat}, {selected.gpsLng}</span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={labels.next}
                  onClick={() => step(1)}
                  disabled={filtered.length < 2}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) disabled:opacity-40 rtl:rotate-180"
                >
                  <ChevronRight size={16} />
                </button>
                <a
                  href={external!}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg bg-(--brand-500)/10 px-3 py-1.5 text-xs font-bold text-(--brand-600)"
                >
                  {labels.openMaps} ↗
                </a>
              </div>
              <iframe
                key={selected.id}
                title={selected.name}
                src={embed}
                className="w-full flex-1 border-0 min-h-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : (
            <p className="rounded-2xl border border-(--border-default) p-6 text-center text-sm opacity-60">{labels.empty}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/// Zone drill-down: lists wilayas/secteurs with client counts in place of
/// the client list; tapping one shows its clients (+ back to all zones).
function ZoneDrill({
  mode,
  wilayas,
  secteurs,
  zoneWilaya,
  zoneSecteur,
  onZone,
  labels,
}: {
  mode: "wilaya" | "secteur";
  wilayas: Array<{ code: number; nameAr: string; count: number }>;
  secteurs: Array<{ id: string; name: string; count: number }>;
  zoneWilaya: number | null;
  zoneSecteur: string | null;
  onZone: (wilaya: number | null, secteur: string | null) => void;
  labels: Record<string, string>;
}) {
  if (mode === "wilaya" && zoneWilaya == null) {
    return (
      <>
        {wilayas.map((w) => (
          <button
            key={w.code}
            type="button"
            onClick={() => onZone(w.code, null)}
            className="flex w-full items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start transition-colors hover:border-(--brand-500)"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--brand-500)/10 text-xs font-black text-(--brand-600)">
              {w.code}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{w.nameAr}</span>
            <span className="shrink-0 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs font-black">{w.count}</span>
          </button>
        ))}
      </>
    );
  }
  if (mode === "secteur" && zoneSecteur == null) {
    return (
      <>
        {secteurs.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onZone(null, s.id)}
            className="flex w-full items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start transition-colors hover:border-(--brand-500)"
          >
            <MapPin size={16} className="shrink-0 opacity-50" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.name}</span>
            <span className="shrink-0 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs font-black">{s.count}</span>
          </button>
        ))}
      </>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onZone(null, null)}
      className="flex w-full items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-sunken) p-2.5 text-xs font-black transition-colors hover:border-(--brand-500)"
    >
      <span aria-hidden>‹</span> {mode === "wilaya" ? labels.allWilayas : labels.allSecteurs}
    </button>
  );
}
