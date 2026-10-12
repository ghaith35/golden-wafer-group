"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Crosshair, Navigation, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { KpiCard } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { VanMark } from "@/components/map/VansMap";

// Leaflet touches `window` at import time — it can only load in the browser.
const VansMap = dynamic(
  () => import("@/components/map/VansMap").then((m) => m.VansMap),
  { ssr: false, loading: () => <div className="h-[420px] animate-pulse rounded-2xl bg-(--bg-sunken)" /> }
);

type VanPos = {
  id: string;
  name: string;
  marque: string | null;
  matricule: string | null;
  lat: number | null;
  lng: number | null;
  seenAt: string | null;
  locateRequested: boolean;
  driver: { fullName: string; username: string } | null;
};

type Status = "online" | "stale" | "offline" | "nosignal";

function statusOf(seenAt: string | null, now: number): Status {
  if (!seenAt) return "nosignal";
  const age = now - new Date(seenAt).getTime();
  if (age < 5 * 60 * 1000) return "online";
  if (age < 30 * 60 * 1000) return "stale";
  return "offline";
}

const DOT: Record<Status, string> = {
  online: "bg-emerald-500",
  stale: "bg-amber-500",
  offline: "bg-red-500",
  nosignal: "bg-gray-400",
};

function ago(seenAt: string | null, neverSeen: string): string {
  if (!seenAt) return neverSeen;
  const mins = Math.max(0, Math.round((Date.now() - new Date(seenAt).getTime()) / 60000));
  if (mins < 1) return "·";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}min`;
  return new Date(seenAt).toLocaleString();
}

export function SuiviClient({ labels }: { labels: Record<string, string> }) {
  const [vans, setVans] = useState<VanPos[]>([]);
  const [auto, setAuto] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [locating, setLocating] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(id);
  }, [auto, load]);

  // Re-render ages every 30s even without new data.
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  /// Ask the driver's phone to send its position now. The APK polls the
  /// flag and reports immediately; the next auto-refresh shows the result.
  async function requestLocate(v: VanPos) {
    setLocating(v.id);
    try {
      const res = await fetch(`/api/vans/${v.id}/locate`, { method: "POST" });
      if (res.ok) {
        setVans((prev) => prev.map((x) => (x.id === v.id ? { ...x, locateRequested: true } : x)));
      }
    } catch { /* offline — keep state */ } finally {
      setLocating(null);
    }
  }

  const marks: VanMark[] = useMemo(
    () =>
      vans
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const st = statusOf(v.seenAt, tick);
          return {
            id: v.id,
            name: v.name,
            lat: v.lat,
            lng: v.lng,
            status: st === "nosignal" ? "offline" : st,
            statusLabel: labels[st === "nosignal" ? "noSignal" : st] ?? st,
            driver: v.driver?.fullName ?? null,
            seenLabel: ago(v.seenAt, labels.neverSeen ?? ""),
          };
        }),
    [vans, tick, labels]
  );

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="grid grid-cols-3 gap-2">
        <KpiCard
          label={labels.online}
          value={String(vans.filter((v) => statusOf(v.seenAt, tick) === "online").length)}
          icon={<Navigation size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact
        />
        <KpiCard
          label={labels.stale}
          value={String(vans.filter((v) => statusOf(v.seenAt, tick) === "stale").length)}
          icon={<Truck size={18} />}
          accent="bg-amber-500/15 text-amber-600"
          compact
        />
        <KpiCard
          label={labels.offline}
          value={String(vans.filter((v) => { const s = statusOf(v.seenAt, tick); return s === "offline" || s === "nosignal"; }).length)}
          icon={<Crosshair size={18} />}
          accent="bg-red-500/15 text-red-500"
          compact
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-bold opacity-70">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            {labels.autoRefresh}
          </label>
          <Button variant="secondary" onClick={() => void load()} disabled={spinning}>
            <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
            <span className="ms-1">{labels.refresh}</span>
          </Button>
        </div>
      </div>

      <VansMap marks={marks} />

      {vans.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {vans.map((v) => {
          const st = statusOf(v.seenAt, tick);
          const statusKey = st === "nosignal" ? "noSignal" : st;
          return (
            <div key={v.id} className="flex items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
              <span className={cn("h-3 w-3 shrink-0 rounded-full", DOT[st])} />
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
                <Truck size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{v.name}</div>
                <div className="truncate text-xs opacity-60">
                  {v.driver ? `${labels.driver}: ${v.driver.fullName}` : v.matricule ?? ""}
                </div>
                <div className="truncate text-[11px] font-bold opacity-70">
                  {labels[statusKey] ?? st}
                  {v.seenAt ? ` · ${labels.lastSeen}: ${ago(v.seenAt, "")}` : ` · ${labels.neverSeen}`}
                </div>
              </div>
              {v.lat != null && v.lng != null && (
                <a
                  href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg bg-(--bg-sunken) px-2 py-1.5 text-[11px] font-black hover:bg-(--brand-500)/15"
                >
                  {labels.openMaps}
                </a>
              )}
              <button
                type="button"
                onClick={() => void requestLocate(v)}
                disabled={locating === v.id || v.locateRequested}
                title={labels.locate}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-black",
                  v.locateRequested
                    ? "bg-amber-500/15 text-amber-600"
                    : "bg-(--brand-500)/10 text-(--brand-600) hover:bg-(--brand-500)/20 disabled:opacity-50"
                )}
              >
                <Crosshair size={13} className={locating === v.id ? "animate-spin" : ""} />
                {v.locateRequested ? labels.locateSent : labels.locate}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
