"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import type { GpsPerm } from "@/lib/van-gps";

/// Key shared with VanTracker: the APK's provisioned device token.
const TOKEN_KEY = "dili_device_token";
const POLL_MS = 30000;

export type LocationPromptLabels = {
  title: string;
  hint: string;
  enable: string;
  deniedHint: string;
};

/// "The office can't see you" banner (van phones only — needs the device
/// token, so desktop browsers never render it).
/// Shows when the phone CANNOT report position: permission missing while
/// the office explicitly requested a locate, or permission denied with no
/// fix ever sent. The enable button summons the REAL Android
/// allow-location form (Capacitor requestPermissions) — the dialog drivers
/// were never seeing — then reports a fix immediately instead of waiting
/// for the next 30s tick. Dismiss (✕) snoozes until the next fresh office
/// request; permanently-denied phones get the settings hint instead.
export function LocationPrompt({ labels }: { labels: LocationPromptLabels }) {
  const [token, setToken] = useState<string | null>(null);
  const [perm, setPerm] = useState<GpsPerm>("unknown");
  const [wanted, setWanted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [snoozed, setSnoozed] = useState<string | null>(null);
  const trigger = wanted ? "req" : "never";
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    let t: string | null = null;
    try {
      t = localStorage.getItem(TOKEN_KEY);
    } catch { /* private mode */ }
    if (!t) return;
    if (liveRef.current) setToken(t);

    let stopped = false;
    async function check() {
      if (stopped) return;
      try {
        const m = await import("@/lib/van-gps");
        const [p, w] = await Promise.all([
          m.checkGpsPermission().catch(() => "unknown" as GpsPerm),
          (async () => {
            try {
              const r = await fetch("/api/track/pending", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceToken: t }),
              }).catch(() => null);
              if (!r?.ok) return false;
              const d = await r.json().catch(() => null);
              return d?.locateRequested === true;
            } catch {
              return false;
            }
          })(),
        ]);
        if (stopped || !liveRef.current) return;
        setPerm(p);
        // Fresh office request unsnoozes (the admin is looking NOW) and
        // clears a stale denial notice (the state may have changed).
        if (w) {
          setSnoozed(null);
          setDenied(false);
        }
        setWanted(w);
        if (p === "granted") setDenied(false);
      } catch { /* never break the page */ }
    }
    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    const onVis = () => {
      // Back from Settings (possibly just granted): re-evaluate now.
      try {
        if (!document.hidden) void check();
      } catch { /* ignore */ }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  if (!token) return null;
  const blocked = perm === "denied" || perm === "prompt" || perm === "unknown";
  if (!blocked || (!wanted && perm !== "denied")) return null;
  if (snoozed === trigger) return null;

  async function enable() {
    if (busy) return;
    setBusy(true);
    setDenied(false);
    try {
      const m = await import("@/lib/van-gps");
      const ok = await m.requestGpsPermission();
      const now = await m.checkGpsPermission().catch(() => "unknown" as GpsPerm);
      if (!liveRef.current) return;
      setPerm(now);
      if (ok && now === "granted") {
        // Granted: report a fix RIGHT NOW (don't wait for the tick) so
        // the admin's locate request answers while he's watching.
        const fix = await m.getGpsFix().catch(() => null);
        if (fix && liveRef.current) {
          await fetch("/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              deviceToken: token,
              lat: fix.lat,
              lng: fix.lng,
              accuracy: Math.round(fix.accuracy ?? 0) || undefined,
              speed: fix.speedKmh ?? undefined,
            }),
          }).catch(() => {});
        }
        return;
      }
      setDenied(true);
    } catch {
      if (liveRef.current) setDenied(true);
    } finally {
      if (liveRef.current) setBusy(false);
    }
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-2xl border border-amber-500/40 bg-(--bg-overlay) p-3 shadow-2xl lg:bottom-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
          <MapPin size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-black">{labels.title}</div>
          <div className="mt-0.5 text-[11px] font-bold leading-4 opacity-70">{denied ? labels.deniedHint : labels.hint}</div>
        </div>
        <button
          type="button"
          onClick={() => setSnoozed(trigger)}
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-(--border-default) opacity-70 hover:opacity-100"
        >
          <X size={14} />
        </button>
      </div>
      {!denied && (
        <button
          onClick={() => void enable()}
          disabled={busy}
          className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-(--brand-500) text-sm font-black text-(--brand-contrast) disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
          {labels.enable}
        </button>
      )}
    </div>
  );
}
