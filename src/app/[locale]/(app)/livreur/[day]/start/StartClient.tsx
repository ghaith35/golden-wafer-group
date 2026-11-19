"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { checkGpsPermission, requestGpsPermission, type GpsPerm } from "@/lib/gps-permission";
import { queueOp, goPage, warmJourneePages } from "@/lib/sync/client";

/// Start-of-day gate: live clock + validate to stamp départ, then clients.
export function StartClient({
  locale,
  day,
  dateIso,
  vanName,
  tourneeId,
  startedAt,
  stopsCount,
  labels,
}: {
  locale: string;
  day: string;
  dateIso: string;
  vanName: string;
  tourneeId: string | null;
  startedAt: string | null;
  stopsCount: number;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  /// Live clock: null until mounted so server and client render the same
  /// placeholder (a ticking Date in state always mismatches hydration).
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string | null>(startedAt);
  const [startQueued, setStartQueued] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /// Location permission state (asked once here, then lazily per feature).
  const [gps, setGps] = useState<GpsPerm | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    checkGpsPermission().then(setGps).catch(() => {});
    // Warm the next pages while online so the journée works fully offline.
    warmJourneePages(locale, day);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = new Date(dateIso);

  /// Best-effort GPS fix for the départ stamp (never blocks the day).
  async function currentPos(): Promise<{ lat: number; lng: number } | null> {
    try {
      if (!("geolocation" in navigator)) return null;
      const p: GeolocationPosition = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 })
      );
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch {
      return null;
    }
  }

  async function validate() {
    if (started) {
      goPage(router, `/${locale}/livreur/${day}`);
      return;
    }
    // Ask for location first (system popup) — but never block the day:
    // denial only disables tracking, stamped below.
    if (gps !== "granted" && gps !== "denied") {
      setGps(await requestGpsPermission().catch(() => "prompt" as GpsPerm));
    }
    // No planned tour this day (admin didn't plan one): create the van's
    // tour on the spot so départ stamps and the journée locks like a
    // planned day. The server restricts staff to their own van.
    // GPS is captured once for the stamp (best-effort, never blocking).
    const pos = await currentPos();
    const stamp = pos ? { lat: pos.lat, lng: pos.lng } : {};
    let stampId = tourneeId;
    if (!stampId) {
      setBusy(true);
      try {
        const res = await fetch("/api/tournees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dateIso, locationId: "__mine__", findOrCreate: true }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.id) {
          stampId = d.id as string;
        } else if (d?.error !== "duplicate_day") {
          setStartError(d?.error ?? "failed");
          setBusy(false);
          return;
        }
      } catch {
        // Offline with no planned tour: queue an ensure+stamp by van+day —
        // the server finds or creates the tour at sync time.
        try {
          await queueOp("day-start", { dateIso: dateIso.slice(0, 10), ...stamp });
          setStarted(new Date().toISOString());
          setStartQueued(true);
        } catch {
          setStartError("save_failed");
        } finally {
          setBusy(false);
        }
        goPage(router, `/${locale}/livreur/${day}`);
        return;
      }
      setBusy(false);
    }
    if (stampId) {
      setBusy(true);
      try {
        const res = await fetch(`/api/tournees/${stampId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", ...stamp }),
        });
        if (res.ok) {
          const d = await res.json();
          setStarted(d.startedAt ?? new Date().toISOString());
        } else {
          const d = await res.json().catch(() => null);
          setStartError(d?.error ?? "failed");
        }
      } catch {
        // Offline: queue the start, continue into the day anyway.
        try {
          await queueOp("day-start", { tourneeId: stampId, ...stamp });
          setStarted(new Date().toISOString());
          setStartQueued(true);
        } catch {
          setStartError("save_failed");
        }
      } finally {
        setBusy(false);
      }
    }
    goPage(router, `/${locale}/livreur/${day}`);
  }

  return (
    <div className="flex min-h-[calc(var(--vh)*0.7)] flex-col items-center justify-center gap-4 p-5 text-center">
      <button
        aria-label="back"
        onClick={() => goPage(router, `/${locale}/livreur`)}
        className="absolute start-4 top-4 flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default)"
      >
        <ArrowLeft size={18} className="rtl:rotate-180" />
      </button>
      <p className="text-lg font-black">
        {date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <p className="text-xs font-bold opacity-60">{vanName}</p>
      <p className="font-mono text-6xl font-black tabular-nums" dir="ltr">
        {now ? now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "…"}
      </p>
      {/* Départ checklist: what's waiting today, at a glance. */}
      {!started && (
        <div className="w-full max-w-xs space-y-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 text-start">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="opacity-60">{labels.clients}</span>
            <span className="tabular-nums" dir="ltr">{stopsCount}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="opacity-60">GPS</span>
            <span className={gps === "granted" ? "text-emerald-600" : gps === "denied" ? "text-red-500" : "opacity-60"}>
              {gps === "granted" ? "✓" : gps === "denied" ? "✕" : "…"}
            </span>
          </div>
        </div>
      )}
      {started ? (
        <p className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-black text-emerald-600">
          <Check size={16} />
          <span className="tabular-nums" dir="ltr">
            {new Date(started).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </p>
      ) : null}
      <Button onClick={() => void validate()} disabled={busy} className="h-14 w-full max-w-xs text-lg">
        {busy ? "…" : started ? labels.clients : (
          <span className="flex items-center gap-2">
            <Play size={20} />
            {labels.startDay}
          </span>
        )}
      </Button>
      {startQueued && (
        <p className="max-w-xs rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">{labels.dayQueued ?? ""}</p>
      )}
      {startError && (
        <p className="max-w-xs rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500">{startError}</p>
      )}
      {!started && gps !== "granted" && (
        <button
          type="button"
          onClick={() => void requestGpsPermission().then(setGps).catch(() => {})}
          className={
            gps === "denied"
              ? "max-w-xs rounded-xl bg-red-500/10 p-2.5 text-xs font-bold text-red-500"
              : "max-w-xs rounded-xl bg-(--bg-sunken) p-2.5 text-xs font-bold opacity-70"
          }
        >
          {gps === "denied" ? (labels.gpsDenied ?? "") : gps === null ? "…" : (labels.gpsWhy ?? "")}
        </button>
      )}
      {!started && gps === "granted" && (
        <p className="text-xs font-bold text-emerald-600">{labels.gpsGranted ?? ""}</p>
      )}
    </div>
  );
}
