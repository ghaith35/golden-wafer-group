"use client";

import { EmptyState } from "@/components/motion/EmptyState";
import { Inbox } from "lucide-react";
import { toast as ui } from "@/lib/toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Crosshair, Globe, MapPin, Navigation, RefreshCw, Route, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { KpiCard } from "@/components/ui/Card";
import { ClientName } from "@/components/clients/ClientName";
import { matchClient } from "@/lib/clients/display";
import { haversineM } from "@/lib/geo-math";
import { proximityOf, PROX_HEX } from "@/lib/proximity";
import { cn } from "@/lib/utils";
import type { CmdVan, CmdClient, CmdZonePin } from "@/components/map/CommandMap";

// Leaflet touches `window` at import time — browser only.
const CommandMap = dynamic(() => import("@/components/map/CommandMap").then((m) => m.CommandMap), {
  ssr: false,
  loading: () => <div className="h-full min-h-[320px] animate-pulse rounded-2xl bg-(--bg-sunken)" />,
});

export type GpsClient = {
  id: string; code: string; name: string; phone: string | null;
  gpsLat: number; gpsLng: number;
  secteur: { name: string } | null;
  wilaya: { code: number; nameAr: string } | null;
};

type VanPos = {
  id: string; name: string; marque: string | null; matricule: string | null;
  lat: number | null; lng: number | null; seenAt: string | null; locateRequested: boolean;
  driver: { fullName: string; username: string } | null;
  /// What the phone says about its own tracking health (APK ≥ 1.20).
  trackState?: { fine?: boolean; always?: boolean; battery?: boolean; gps?: boolean; notifications?: boolean; service?: boolean; queued?: number; app?: string; at?: string } | null;
};
type Status = "online" | "stale" | "offline" | "nosignal";
type Tab = "vans" | "client" | "wilaya" | "secteur";

function statusOf(seenAt: string | null, now: number): Status {
  if (!seenAt) return "nosignal";
  const age = now - new Date(seenAt).getTime();
  if (age < 5 * 60 * 1000) return "online";
  if (age < 30 * 60 * 1000) return "stale";
  return "offline";
}
const DOT: Record<Status, string> = { online: "bg-emerald-500", stale: "bg-amber-500", offline: "bg-red-500", nosignal: "bg-gray-400" };

function ago(seenAt: string | null, neverSeen: string): string {
  if (!seenAt) return neverSeen;
  const mins = Math.max(0, Math.round((Date.now() - new Date(seenAt).getTime()) / 60000));
  if (mins < 1) return "·";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}min`;
  return new Date(seenAt).toLocaleString();
}
/// Plain-language tracking health of a van phone (null = nothing to report).
function health(v: VanPos, labels: Record<string, string>): { ok: boolean; text: string } | null {
  const ts = v.trackState;
  if (!ts) return null;
  if (ts.fine === false) return { ok: false, text: labels.healthNoFine };
  if (ts.gps === false) return { ok: false, text: labels.healthNoGps };
  if (ts.always === false) return { ok: false, text: labels.healthNoBg };
  if (ts.battery === false) return { ok: false, text: labels.healthBattery };
  return { ok: true, text: labels.healthOk };
}
const fmtM = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
/// Admin scale for "distance from the selected van" (the driver screen uses
/// door-step metres instead): ≤ 2 km green · ≤ 10 km orange · beyond red.
const VAN_NEAR_M = 2000;
const VAN_MID_M = 10000;

/// تتبع GPS + الخريطة in one: live vans, every geolocated client, zone
/// browsing (client / wilaya / sector) — all on one shared offline map.
export function SuiviClient({
  clients, secteurs, labels,
}: {
  clients: GpsClient[];
  secteurs: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
}) {
  const [vans, setVans] = useState<VanPos[]>([]);
  const [auto, setAuto] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [locating, setLocating] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  const [tab, setTabRaw] = useState<Tab>("vans");
  const [q, setQ] = useState("");
  const [zoneWilaya, setZoneWilaya] = useState<number | null>(null);
  const [zoneSecteur, setZoneSecteur] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVanId, setSelectedVanId] = useState<string | null>(null);
  const [showVans, setShowVans] = useState(true);
  const [showClients, setShowClients] = useState(true);
  const [showZone, setShowZone] = useState(true);
  const [colorByVan, setColorByVan] = useState(false);
  const [googleView, setGoogleView] = useState(false);
  const [nonce, setNonce] = useState(0);
  const bump = () => setNonce((n) => n + 1);
  /// The selected van's trail for one day (orange line on the map).
  const [showTrail, setShowTrail] = useState(true);
  const [trailDay, setTrailDay] = useState("");
  const [trail, setTrail] = useState<Array<[number, number]> | null>(null);
  /// After "request location": refresh every 4 s for a minute, so the answer shows as it lands.
  /// Vans we asked just now: waiting for the phone's answer (since = when asked).
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  /// Small message at the bottom: the phone answered / did not answer.
  const showToast = (ok: boolean, text: string) => (ok ? ui.success(text, 4500) : ui.error(text, 5500));

  const load = useCallback(async () => {
    setSpinning(true);
    try {
      const res = await fetch("/api/vans/positions", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setVans(d.vans ?? []);
        setTick(Date.now());
      }
    } catch { /* offline — keep last */ } finally {
      setSpinning(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(id);
  }, [auto, load]);
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const waitingIds = Object.keys(waiting).join(",");
  const waitingRef = useRef(waiting);
  const setWaitingBoth = (w: Record<string, number>) => {
    waitingRef.current = w;
    setWaiting(w);
  };
  // While we wait for an answer, look every 2 s — it lands as soon as the phone sends it.
  // Answered (the server cleared the request) → confirm and show the van.
  // No answer within 40 s → a small red message saying so (and why, when we know).
  useEffect(() => {
    if (!waitingIds) return;
    let dead = false;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch("/api/vans/positions", { cache: "no-store" });
        if (!res.ok || dead) return;
        const list: VanPos[] = (await res.json()).vans ?? [];
        setVans(list);
        setTick(Date.now());
        const cur = { ...waitingRef.current };
        let changed = false;
        for (const vid of Object.keys(cur)) {
          const v = list.find((x) => x.id === vid);
          if (!v) continue;
          const answered = !v.locateRequested || (v.seenAt != null && new Date(v.seenAt).getTime() >= cur[vid] - 2000);
          if (answered) {
            delete cur[vid];
            changed = true;
            showToast(true, labels.locateOk.replace("{name}", v.name));
            setSelectedVanId(vid);
            bump();
          } else if (Date.now() - cur[vid] > 40_000) {
            delete cur[vid];
            changed = true;
            const why = health(v, labels);
            showToast(false, `${labels.locateFail.replace("{name}", v.name)} — ${why && !why.ok ? why.text : labels.locateFailWhy}`);
          }
        }
        if (changed) setWaitingBoth(cur);
      } catch {
        /* offline: keep waiting; the 40 s limit still applies on the next beat */
      }
    }, 2000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingIds]);

  /// Ask the driver's phone to send its position now.
  async function requestLocate(v: VanPos) {
    setLocating(v.id);
    try {
      const res = await fetch(`/api/vans/${v.id}/locate`, { method: "POST" });
      if (res.ok) {
        setVans((prev) => prev.map((x) => (x.id === v.id ? { ...x, locateRequested: true } : x)));
        setWaitingBoth({ ...waitingRef.current, [v.id]: Date.now() });
        void load();
      }
    } catch { /* offline */ } finally {
      setLocating(null);
    }
  }

  // ───── clients / zones (the old الخريطة page) ─────
  const wilayas = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clients) if (c.wilaya && !map.has(c.wilaya.code)) map.set(c.wilaya.code, c.wilaya.nameAr);
    return [...map.entries()]
      .map(([code, nameAr]) => ({ code, nameAr, count: clients.filter((c) => c.wilaya?.code === code).length }))
      .sort((a, b) => a.code - b.code);
  }, [clients]);
  const zoneSecteurs = useMemo(
    () => secteurs.map((s) => ({ ...s, count: clients.filter((c) => c.secteur?.name === s.name).length })),
    [clients, secteurs]
  );

  const filtered = useMemo(() => {
    let rows = clients;
    if (tab === "wilaya" && zoneWilaya != null) rows = rows.filter((c) => c.wilaya?.code === zoneWilaya);
    if (tab === "secteur" && zoneSecteur != null) {
      const name = secteurs.find((s) => s.id === zoneSecteur)?.name;
      rows = rows.filter((c) => c.secteur?.name === name);
    }
    if (tab === "client" && q) rows = rows.filter((c) => matchClient(q, c));
    return rows;
  }, [clients, tab, q, zoneWilaya, zoneSecteur, secteurs]);

  const zoneTapped = (tab === "wilaya" && zoneWilaya != null) || (tab === "secteur" && zoneSecteur != null);
  const selected =
    filtered.find((c) => c.id === selectedId) ?? (tab === "client" || zoneTapped ? filtered[0] ?? null : null);
  const selIndex = selected ? filtered.findIndex((c) => c.id === selected.id) : -1;
  const step = (dir: 1 | -1) => {
    if (filtered.length === 0) return;
    setSelectedId(filtered[(selIndex + dir + filtered.length) % filtered.length].id);
    bump();
  };

  const tourUrl =
    filtered.length > 1
      ? `https://www.google.com/maps/dir/?api=1&destination=${filtered[filtered.length - 1].gpsLat},${filtered[filtered.length - 1].gpsLng}&waypoints=${filtered
          .slice(0, -1).slice(0, 9).map((c) => `${c.gpsLat},${c.gpsLng}`).join("%7C")}`
      : null;
  const zoneLabel =
    tab === "wilaya" ? wilayas.find((w) => w.code === zoneWilaya)?.nameAr ?? labels.tabWilaya
    : tab === "secteur" ? secteurs.find((s) => s.id === zoneSecteur)?.name ?? labels.tabSecteur : "";

  // ───── vans (the old تتبع GPS page) ─────
  const vanMarks: CmdVan[] = useMemo(
    () =>
      vans.filter((v) => v.lat != null && v.lng != null).map((v) => {
        const st = statusOf(v.seenAt, tick);
        return {
          id: v.id, name: v.name, lat: v.lat as number, lng: v.lng as number,
          status: st === "nosignal" ? "offline" : st,
          statusLabel: labels[st === "nosignal" ? "noSignal" : st] ?? st,
          driver: v.driver?.fullName ?? null,
          seenLabel: ago(v.seenAt, labels.neverSeen ?? ""),
        };
      }),
    [vans, tick, labels]
  );
  const selVan = vans.find((v) => v.id === selectedVanId && v.lat != null && v.lng != null) ?? null;
  // Trail of the selected van for the chosen day (re-read every refresh while it is today).
  const trailVanId = selVan?.id ?? null;
  useEffect(() => {
    if (!trailVanId || !showTrail) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears when nothing is selected
      setTrail(null);
      return;
    }
    let dead = false;
    fetch(`/api/vans/${trailVanId}/trail${trailDay ? `?day=${trailDay}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!dead) setTrail(d?.points?.length ? d.points.map((p: { lat: number; lng: number }) => [p.lat, p.lng] as [number, number]) : null);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [trailVanId, showTrail, trailDay, tick]);
  const vanQ = q.trim().toLowerCase();
  const shownVans = tab === "vans" && vanQ
    ? vans.filter((v) => [v.name, v.matricule, v.driver?.fullName].some((x) => x?.toLowerCase().includes(vanQ)))
    : vans;

  // Nearest van to the selected client (straight line).
  const nearest = useMemo(() => {
    if (!selected) return null;
    let best: { van: VanPos; m: number } | null = null;
    for (const v of vans) {
      if (v.lat == null || v.lng == null) continue;
      const m = haversineM(v.lat, v.lng, selected.gpsLat, selected.gpsLng);
      if (!best || m < best.m) best = { van: v, m };
    }
    return best;
  }, [vans, selected]);

  // ───── map data ─────
  const mapClients: CmdClient[] = useMemo(() => {
    const base = tab === "vans" ? clients : filtered;
    return base.map((c) => {
      let color = "#c9951a";
      if (colorByVan && selVan) {
        color = PROX_HEX[proximityOf(haversineM(selVan.lat as number, selVan.lng as number, c.gpsLat, c.gpsLng), VAN_NEAR_M, VAN_MID_M)];
      }
      return { id: c.id, name: c.name, code: c.code, lat: c.gpsLat, lng: c.gpsLng, color };
    });
  }, [tab, clients, filtered, colorByVan, selVan]);
  const zonePins: CmdZonePin[] = useMemo(
    () => (zoneTapped ? filtered.map((c, i) => ({ id: c.id, name: c.name, code: c.code, lat: c.gpsLat, lng: c.gpsLng, n: i + 1 })) : []),
    [zoneTapped, filtered]
  );
  const link: [[number, number], [number, number]] | null =
    selected && (selVan || nearest)
      ? [
          [selected.gpsLat, selected.gpsLng],
          selVan ? [selVan.lat as number, selVan.lng as number] : [nearest!.van.lat as number, nearest!.van.lng as number],
        ]
      : null;
  const focus: Array<[number, number]> = useMemo(() => {
    if (selected && tab !== "vans") return [[selected.gpsLat, selected.gpsLng]];
    if (selVan) return [[selVan.lat as number, selVan.lng as number]];
    if (zoneTapped) return filtered.map((c) => [c.gpsLat, c.gpsLng] as [number, number]);
    const pts = vanMarks.map((v) => [v.lat, v.lng] as [number, number]);
    return pts.length ? pts : mapClients.slice(0, 200).map((c) => [c.lat, c.lng] as [number, number]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  function switchTab(t: Tab) {
    setTabRaw(t);
    setZoneWilaya(null);
    setZoneSecteur(null);
    setSelectedId(null);
    setGoogleView(false);
    bump();
  }

  const tabBtn = (t: Tab, text: string) => (
    <button
      key={t}
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => switchTab(t)}
      className={cn(
        "min-h-11 min-w-0 flex-1 truncate rounded-md px-2 py-2 text-xs font-black transition-colors",
        tab === t ? "bg-(--bg-overlay) text-(--text-primary) shadow" : "text-(--text-secondary)"
      )}
    >
      {text}
    </button>
  );
  const layerChip = (on: boolean, set: (b: boolean) => void, text: string) => (
    <button
      type="button"
      onClick={() => set(!on)}
      aria-pressed={on}
      className={cn(
        "h-9 shrink-0 rounded-full px-3.5 text-xs font-black transition-colors",
        on ? "bg-gradient-brand text-(--brand-contrast) shadow" : "border border-(--border-default) bg-(--bg-overlay) opacity-70"
      )}
    >
      {text}
    </button>
  );
  const online = typeof navigator === "undefined" || navigator.onLine !== false;

  return (
    <div className="space-y-3 p-3 md:p-5">
      <div className="grid grid-cols-3 gap-2">
        <KpiCard label={labels.online} value={String(vans.filter((v) => statusOf(v.seenAt, tick) === "online").length)} icon={<Navigation size={18} />} accent="bg-emerald-500/15 text-emerald-600" valueClassName="whitespace-normal! text-clip! break-words leading-tight" compact />
        <KpiCard label={labels.stale} value={String(vans.filter((v) => statusOf(v.seenAt, tick) === "stale").length)} icon={<Truck size={18} />} accent="bg-amber-500/15 text-amber-600" compact />
        <KpiCard label={labels.offline} value={String(vans.filter((v) => { const s = statusOf(v.seenAt, tick); return s === "offline" || s === "nosignal"; }).length)} icon={<Crosshair size={18} />} accent="bg-red-500/15 text-red-500" compact />
      </div>

      {/* Toolbar: layers · colour-by-van · tour link · auto/refresh */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
          {layerChip(showVans, setShowVans, `🚚 ${labels.layerVans} (${vanMarks.length})`)}
          {layerChip(showClients, setShowClients, `📍 ${labels.layerClients} (${mapClients.length})`)}
          {zoneTapped && layerChip(showZone, setShowZone, `① ${labels.layerZone} (${zonePins.length})`)}
          {layerChip(colorByVan, (b) => { setColorByVan(b); }, `🎨 ${labels.colorByVan}`)}
          {layerChip(showTrail, setShowTrail, `〰 ${labels.trailLabel}`)}
          {showTrail && selVan && (
            <input type="date" value={trailDay} onChange={(e) => setTrailDay(e.target.value)} dir="ltr" aria-label={labels.trailLabel}
              className="h-9 shrink-0 rounded-full border border-(--border-default) bg-(--bg-overlay) px-3 text-xs font-black outline-none focus:border-(--brand-500)" />
          )}
        </div>
        {tourUrl && (
          <a href={tourUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-(--brand-500)/10 px-3 py-2 text-xs font-bold text-(--brand-600)">
            <Route size={14} />
            {labels.openTour} ({filtered.length}) ↗
          </a>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold opacity-70">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          {labels.autoRefresh}
        </label>
        <Button variant="secondary" onClick={() => void load()} disabled={spinning}>
          <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
          <span className="ms-1">{labels.refresh}</span>
        </Button>
      </div>
      {colorByVan && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-black">
          <span className="opacity-60">{selVan ? `🚚 ${selVan.name}` : labels.pickVanHint}</span>
          {(["near", "mid", "far"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ background: PROX_HEX[k] }} />
              {labels[`color_${k}`]}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[360px_1fr]">
        {/* Map side (first on phones) */}
        <div className="order-1 space-y-2 lg:order-2">
          {selected && tab !== "vans" && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2.5">
              <button type="button" aria-label={labels.prev} onClick={() => step(-1)} disabled={filtered.length < 2}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) disabled:opacity-40 rtl:rotate-180">
                <ChevronLeft size={16} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{zoneLabel ? `${zoneLabel} · ` : ""}{selected.name}</div>
                <div className="truncate text-xs opacity-60">
                  {selIndex + 1} / {filtered.length} · <span className="font-mono" dir="ltr">{selected.gpsLat}, {selected.gpsLng}</span>
                  {nearest && <> · 🚚 {nearest.van.name} · {fmtM(nearest.m)}</>}
                </div>
              </div>
              <button type="button" aria-label={labels.next} onClick={() => step(1)} disabled={filtered.length < 2}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) disabled:opacity-40 rtl:rotate-180">
                <ChevronRight size={16} />
              </button>
              {nearest && (
                <button type="button" onClick={() => { setSelectedVanId(nearest.van.id); setColorByVan(true); }}
                  className="shrink-0 rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-xs font-bold">
                  🚚 {labels.nearestVan}
                </button>
              )}
              {online && (
                <button type="button" onClick={() => setGoogleView((g) => !g)} aria-pressed={googleView}
                  className={cn("flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold", googleView ? "bg-gradient-brand text-(--brand-contrast)" : "bg-(--bg-sunken)")}>
                  <Globe size={13} /> {googleView ? labels.mapView : labels.googleView}
                </button>
              )}
              <a href={`https://www.google.com/maps?q=${selected.gpsLat},${selected.gpsLng}`} target="_blank" rel="noreferrer"
                className="shrink-0 rounded-lg bg-(--brand-500)/10 px-3 py-1.5 text-xs font-bold text-(--brand-600)">
                {labels.openMaps} ↗
              </a>
            </div>
          )}
          <div className="h-[52vh] min-h-[320px] overflow-hidden rounded-2xl lg:h-[calc(var(--vh)-300px)] lg:min-h-[460px]">
            {googleView && selected && online ? (
              <iframe key={selected.id} title={selected.name} className="h-full w-full border-0"
                src={`https://www.google.com/maps?q=${selected.gpsLat},${selected.gpsLng}&z=15&output=embed`}
                loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            ) : (
              <CommandMap
                vans={vanMarks}
                clients={mapClients}
                zonePins={zonePins}
                showVans={showVans}
                showClients={showClients}
                showZone={showZone}
                selectedClientId={selected?.id ?? null}
                selectedVanId={selectedVanId}
                link={link}
                trail={trail}
                focus={focus}
                nonce={nonce}
                onPickClient={(id) => { setSelectedId(id); if (tab === "vans") setTabRaw("client"); bump(); }}
                onPickVan={(id) => { setSelectedVanId(id); setTabRaw("vans"); bump(); }}
              />
            )}
          </div>
          {zoneTapped && filtered.length === 0 && <p className="text-sm opacity-60">{labels.emptyClients}</p>}
        </div>

        {/* Side panel: Vans · Client · Wilaya · Secteur */}
        <div className="order-2 space-y-2 lg:order-1 lg:max-h-[calc(var(--vh)-230px)] lg:overflow-y-auto">
          <div className="flex rounded-lg bg-(--bg-sunken) p-0.5" role="tablist">
            {tabBtn("vans", `🚚 ${labels.tabVans}`)}
            {tabBtn("client", labels.tabClient)}
            {tabBtn("wilaya", labels.tabWilaya)}
            {tabBtn("secteur", labels.tabSecteur)}
          </div>
          {(tab === "vans" || tab === "client") && (
            <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          )}

          {tab === "vans" && (
            <>
              {vans.length === 0 && <EmptyState icon={<Inbox size={30} />} title={labels.empty} className="rounded-2xl border border-dashed border-(--border-default)" />}
              {shownVans.map((v) => {
                const st = statusOf(v.seenAt, tick);
                const statusKey = st === "nosignal" ? "noSignal" : st;
                return (
                  <div key={v.id} className={cn("flex flex-col gap-2.5 rounded-2xl border bg-(--bg-overlay) p-3", v.id === selectedVanId ? "border-(--brand-500)" : "border-(--border-default)")}>
                    <button type="button" className="flex w-full min-w-0 items-center gap-3 text-start"
                      onClick={() => { setSelectedVanId(v.id); bump(); }}>
                      <span className={cn("h-3 w-3 shrink-0 rounded-full", DOT[st])} />
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)"><Truck size={18} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-black">{v.name}</span>
                        <span className="block break-words text-xs opacity-60">{v.driver ? `${labels.driver}: ${v.driver.fullName}` : v.matricule ?? ""}</span>
                        <span className="block break-words text-[11px] font-bold opacity-70">
                          {labels[statusKey] ?? st}
                          {v.seenAt ? ` · ${labels.lastSeen}: ${ago(v.seenAt, "")}` : ` · ${labels.neverSeen}`}
                        </span>
                        {(() => {
                          const h = health(v, labels);
                          return h ? (
                            <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-black", h.ok ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-500")}>
                              {h.ok ? "●" : "⚠"} {h.text}{v.trackState?.queued ? ` · ${v.trackState.queued}` : ""}
                            </span>
                          ) : null;
                        })()}
                      </span>
                    </button>
                    {/* Actions sit on their own row on a phone, so nothing above is squeezed. */}
                    <div className="flex w-full gap-2">
                      {v.lat != null && v.lng != null && (
                        <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noreferrer"
                          className="flex min-h-10 flex-1 items-center justify-center rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-center text-xs font-black hover:bg-(--brand-500)/15">
                          {labels.openMaps}
                        </a>
                      )}
                      <button type="button" onClick={() => void requestLocate(v)} disabled={locating === v.id || v.locateRequested} title={labels.locate}
                        className={cn("flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black",
                          v.locateRequested ? "bg-amber-500/15 text-amber-600" : "bg-(--brand-500)/10 text-(--brand-600) hover:bg-(--brand-500)/20 disabled:opacity-50")}>
                        <Crosshair size={14} className={locating === v.id || waiting[v.id] ? "animate-spin" : ""} />
                        {v.locateRequested ? labels.locateSent : labels.locate}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {tab === "wilaya" && zoneWilaya == null && wilayas.map((w) => (
            <button key={w.code} type="button" onClick={() => { setZoneWilaya(w.code); setSelectedId(null); bump(); }}
              className="flex w-full items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start transition-colors hover:border-(--brand-500)">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--brand-500)/10 text-xs font-black text-(--brand-600)">{w.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{w.nameAr}</span>
              <span className="shrink-0 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs font-black">{w.count}</span>
            </button>
          ))}
          {tab === "secteur" && zoneSecteur == null && zoneSecteurs.map((s) => (
            <button key={s.id} type="button" onClick={() => { setZoneSecteur(s.id); setSelectedId(null); bump(); }}
              className="flex w-full items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start transition-colors hover:border-(--brand-500)">
              <MapPin size={16} className="shrink-0 opacity-50" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.name}</span>
              <span className="shrink-0 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs font-black">{s.count}</span>
            </button>
          ))}
          {zoneTapped && (
            <button type="button" onClick={() => { setZoneWilaya(null); setZoneSecteur(null); setSelectedId(null); bump(); }}
              className="flex w-full items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-sunken) p-2.5 text-xs font-black transition-colors hover:border-(--brand-500)">
              <span aria-hidden>‹</span> {tab === "wilaya" ? labels.allWilayas : labels.allSecteurs}
            </button>
          )}
          {(tab === "client" || zoneTapped) && (
            <>
              <p className="text-xs font-bold opacity-60">{zoneTapped ? `${zoneLabel} · ` : ""}{labels.count}: {filtered.length}</p>
              {filtered.length === 0 && <p className="text-sm opacity-60">{labels.emptyClients}</p>}
              {filtered.map((c) => {
                const d = selVan ? haversineM(selVan.lat as number, selVan.lng as number, c.gpsLat, c.gpsLng) : null;
                return (
                  <button key={c.id} type="button" onClick={() => { setSelectedId(c.id); bump(); }}
                    className={cn("flex w-full items-center gap-2 rounded-xl border p-3 text-start transition-colors",
                      selected?.id === c.id ? "border-(--brand-500) bg-(--brand-500)/5" : "border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)")}>
                    <MapPin size={16} className={cn("shrink-0", selected?.id === c.id ? "text-(--brand-600)" : "opacity-50")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold"><ClientName name={c.name} lat={c.gpsLat} lng={c.gpsLng} /></span>
                      <span className="block truncate text-xs opacity-60">
                        {c.code} {c.wilaya ? `· ${c.wilaya.code} ${c.wilaya.nameAr}` : ""} {c.secteur ? `· ${c.secteur.name}` : ""}
                      </span>
                    </span>
                    {d != null && <span className="shrink-0 text-[11px] font-black tabular-nums" dir="ltr">{fmtM(d)}</span>}
                  </button>
                );
              })}
            </>
          )}
          {(tab === "wilaya" && zoneWilaya == null && wilayas.length === 0) || (tab === "secteur" && zoneSecteur == null && zoneSecteurs.length === 0)
            ? <p className="text-sm opacity-60">{labels.emptyClients}</p> : null}
        </div>
      </div>
    </div>
  );
}
