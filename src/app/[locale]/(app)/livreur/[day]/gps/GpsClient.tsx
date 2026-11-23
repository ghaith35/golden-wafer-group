"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, Navigation, Crosshair } from "lucide-react";
import { goPage } from "@/lib/sync/client";
import { haversineM, formatMeters } from "@/lib/geo-math";
import { proximityOf, PROX_CARD, PROX_HEX, type Proximity } from "@/lib/proximity";
import { RefreshButton } from "@/components/livreur/RefreshButton";
import { ClientName } from "@/components/clients/ClientName";
import { cn } from "@/lib/utils";

// Leaflet needs `window` — browser-only.
const ProximityMap = dynamic(() => import("@/components/map/ProximityMap").then((m) => m.ProximityMap), {
  ssr: false,
  loading: () => <div className="h-[320px] animate-pulse rounded-2xl bg-(--bg-sunken)" />,
});

type C = {
  id: string; code: string; name: string; phone: string | null;
  lat: number; lng: number; secteurId: string | null; secteurName: string | null;
};
type Filter = "all" | "today" | "sector" | `s:${string}`;

export function GpsClient({
  locale, day, hasStarted, todayIds, todaySecteurId, clients, labels,
}: {
  locale: string;
  day: string;
  hasStarted: boolean;
  todayIds: string[];
  todaySecteurId: string | null;
  clients: C[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [filter, setFilterRaw] = useState<Filter>(todayIds.length ? "today" : "all");
  const setFilter = (f: Filter) => {
    setFilterRaw(f);
    setNonce((n) => n + 1); // re-fit the map to the new set
  };
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [nonce, setNonce] = useState(0);

  /// Native-aware GPS fix (works offline — it is the phone's own receiver).
  function locate() {
    setLocating(true);
    void import("@/lib/van-gps")
      .then(async (m) => {
        const f = await m.getGpsFix();
        if (f) setPos({ lat: f.lat, lng: f.lng });
      })
      .catch(() => {})
      .finally(() => setLocating(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time GPS fix
    locate();
  }, []);

  const todaySet = useMemo(() => new Set(todayIds), [todayIds]);
  const sectors = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const c of clients) {
      if (!c.secteurId) continue;
      const e = m.get(c.secteurId) ?? { name: c.secteurName ?? "—", n: 0 };
      e.n++;
      m.set(c.secteurId, e);
    }
    return [...m].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [clients, locale]);
  const todaySector = sectors.find((s) => s.id === todaySecteurId) ?? null;
  const otherSectors = sectors.filter((s) => s.id !== todaySecteurId);

  const rows = useMemo(() => {
    const base = clients.filter((c) =>
      filter === "all" ? true
        : filter === "today" ? todaySet.has(c.id)
        : filter === "sector" ? c.secteurId === todaySecteurId
        : c.secteurId === filter.slice(2)
    );
    const withDist = base.map((c) => {
      const d = pos ? haversineM(pos.lat, pos.lng, c.lat, c.lng) : null;
      return { ...c, distM: d, prox: proximityOf(d) as Proximity };
    });
    // Nearest first once we know where the driver is.
    return pos ? withDist.sort((a, b) => (a.distM ?? 0) - (b.distM ?? 0)) : withDist;
  }, [clients, filter, todaySet, todaySecteurId, pos]);


  const counts = useMemo(() => {
    const c = { near: 0, mid: 0, far: 0 };
    for (const r of rows) if (r.prox !== "none") c[r.prox]++;
    return c;
  }, [rows]);

  const chip = (active: boolean) =>
    cn(
      "h-10 shrink-0 rounded-full px-4 text-xs font-black transition-colors active:scale-95",
      active ? "bg-gradient-brand text-(--brand-contrast) shadow" : "border border-(--border-default) bg-(--bg-overlay)"
    );

  const mapsUrl = (c: C) =>
    pos
      ? `https://www.google.com/maps/dir/?api=1&origin=${pos.lat},${pos.lng}&destination=${c.lat},${c.lng}&travelmode=driving`
      : `https://www.google.com/maps?q=${c.lat},${c.lng}`;
  const online = typeof navigator === "undefined" || navigator.onLine !== false;

  return (
    <div className="space-y-3 p-3 pb-28 md:p-5 md:pb-28">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, hasStarted ? `/${locale}/livreur/${day}/dashboard` : `/${locale}/livreur/${day}/start`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.title} ({rows.length})</h1>
          <p className="truncate text-xs opacity-60">{locating ? labels.locating : pos ? "" : labels.noPos}</p>
        </div>
        <button
          onClick={locate}
          disabled={locating}
          aria-label={labels.refresh}
          title={labels.refresh}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <Crosshair size={16} className={cn(locating && "animate-spin")} />
        </button>
        <RefreshButton label={labels.refresh} onLocal={locate} />
      </div>

      {/* Filters: clients · today · today's sector · every other sector. */}
      <div className="sticky top-0 z-10 -mx-3 bg-(--bg-base) px-3 py-1 md:mx-0 md:px-0">
        <div className="flex gap-1.5 overflow-x-auto pb-1" dir={locale === "ar" ? "rtl" : "ltr"}>
          <button type="button" onClick={() => setFilter("all")} className={chip(filter === "all")}>
            {labels.all} ({clients.length})
          </button>
          <button type="button" onClick={() => setFilter("today")} className={chip(filter === "today")}>
            {labels.today} ({todayIds.length})
          </button>
          {todaySector && (
            <button type="button" onClick={() => setFilter("sector")} className={chip(filter === "sector")}>
              {labels.todaySector} · {todaySector.name} ({todaySector.n})
            </button>
          )}
          {otherSectors.map((s) => (
            <button key={s.id} type="button" onClick={() => setFilter(`s:${s.id}`)} className={chip(filter === `s:${s.id}`)}>
              {s.name} ({s.n})
            </button>
          ))}
        </div>
      </div>

      <ProximityMap
        pins={rows.map((r) => ({ id: r.id, name: r.name, code: r.code, lat: r.lat, lng: r.lng, prox: r.prox }))}
        me={pos}
        nonce={nonce}
        height="min(52vh, 420px)"
      />

      {/* Legend with live counts. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-black">
        {(["near", "mid", "far"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full" style={{ background: PROX_HEX[k] }} />
            {labels[k]} ({counts[k]})
          </span>
        ))}
      </div>

      <div className="space-y-1.5">
        {rows.map((c) => (
          <div key={c.id} className={cn("flex items-center gap-2.5 rounded-2xl border p-3", PROX_CARD[c.prox])}>
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-black text-white"
              style={{ background: PROX_HEX[c.prox] }}
            >
              {c.name.trim().charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center text-sm font-black">
                <ClientName name={c.name} map={false} />
              </span>
              <span className="block truncate font-mono text-[11px] opacity-50" dir="ltr">{c.code}</span>
              {c.distM != null && (
                <span className="block truncate text-[11px] font-black" style={{ color: PROX_HEX[c.prox] }}>
                  {formatMeters(c.distM, labels.unitM, labels.unitKm)}
                </span>
              )}
            </span>
            {c.phone && (
              <a
                href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                aria-label={labels.call}
                title={labels.call}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"
              >
                <Phone size={17} />
              </a>
            )}
            {online && (
              <a
                href={mapsUrl(c)}
                target="_blank"
                rel="noreferrer"
                aria-label="GPS"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)"
              >
                <Navigation size={17} />
              </a>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="py-6 text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
    </div>
  );
}
