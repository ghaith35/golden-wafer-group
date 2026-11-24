"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { checkGpsPermission, requestGpsPermission, type GpsPerm } from "@/lib/gps-permission";
import { queueOp, goPage, warmJourneePages } from "@/lib/sync/client";
import { daySlug } from "../../_days";
import { cn } from "@/lib/utils";

/// Start-of-day gate: live clock + validate to stamp départ, then clients.
export function StartClient({
  locale,
  day,
  dateIso: dateIsoP,
  vanName,
  tourneeId: tourneeIdP,
  startedAt: startedAtP,
  stopsCount: stopsCountP,
  tours = [],
  canChooseDay = false,
  labels,
}: {
  locale: string;
  day: string;
  dateIso: string;
  vanName: string;
  tourneeId: string | null;
  startedAt: string | null;
  stopsCount: number;
  /// Every tour of this day (a van can run two): each has its own clients and
  /// its own start / end of day.
  tours?: Array<{ id: string; secteurName: string | null; stopsCount: number; startedAt: string | null; finishedAt: string | null }>;
  canChooseDay?: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  /// Offline on a new day: the cached copy is relabelled by the service
  /// worker (window.__DILI_DAY_SHIFTED) — its tour belongs to the old day.
  /// Today has no tour yet: stamp with the real date of THIS day instead.
  const [shifted, setShifted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount gate
    if ((window as unknown as { __DILI_DAY_SHIFTED?: string }).__DILI_DAY_SHIFTED) setShifted(true);
  }, []);
  const dayMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(day);
  const dateIso = shifted && dayMatch ? new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3])).toISOString() : dateIsoP;
  const multi = !shifted && tours.length >= 2;
  const [selId, setSelId] = useState<string | null>(tourneeIdP);
  const selTour = multi ? (tours.find((x) => x.id === selId) ?? tours[0]) : null;
  const tourneeId = shifted ? null : multi ? selTour!.id : tourneeIdP;
  const stopsCount = shifted ? 0 : multi ? selTour!.stopsCount : stopsCountP;
  /// One tour of the day is in progress: the other must wait for its end.
  const otherRunning = multi && tours.some((x) => x.id !== selTour!.id && !!x.startedAt && !x.finishedAt);
  const selFinished = !!selTour?.finishedAt;
  /// Live clock: null until mounted so server and client render the same
  /// placeholder (a ticking Date in state always mismatches hydration).
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string | null>(startedAtP);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset once the day is known to be a relabelled copy
    if (shifted) setStarted(null);
  }, [shifted]);
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

  function pickTour(id: string) {
    const tr = tours.find((x) => x.id === id);
    if (!tr) return;
    setSelId(id);
    setStarted(tr.startedAt);
    setStartError(null);
  }

  async function validate() {
    if (started || selFinished) {
      goPage(router, `/${locale}/livreur/${day}`);
      return;
    }
    if (otherRunning) {
      setStartError(labels.finishOtherFirst ?? "finish_other_first");
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
      {/* Day picker: only when Settings > day access lets this user choose. */}
      {canChooseDay && (
        <div className="flex w-full max-w-sm flex-wrap justify-center gap-1.5">
          {Array.from({ length: 7 }, (_, i) => {
            const base = new Date();
            const monday = new Date(base);
            monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const slug = daySlug(d);
            const sel = slug === day;
            return (
              <button
                key={slug}
                onClick={() => !sel && goPage(router, `/${locale}/livreur/${slug}/start`)}
                className={cn(
                  "min-w-[3.2rem] rounded-xl border px-2.5 py-2 text-xs font-black transition-all active:scale-95",
                  sel
                    ? "border-transparent bg-gradient-brand text-(--brand-contrast) shadow"
                    : "border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)"
                )}
              >
                {d.toLocaleDateString(locale, { weekday: "short" })}
              </button>
            );
          })}
        </div>
      )}
      <p className="font-mono text-6xl font-black tabular-nums" dir="ltr">
        {now ? now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "…"}
      </p>
      {/* Two tours today: each with its own clients and its own start/end. */}
      {multi && (
        <div className="w-full max-w-xs space-y-2" role="radiogroup" aria-label={(labels.tourOf ?? "").replace("{n}", "").trim()}>
          {tours.map((tr, i) => {
            const running = !!tr.startedAt && !tr.finishedAt;
            const done = !!tr.finishedAt;
            const on = (selTour?.id ?? "") === tr.id;
            return (
              <button
                key={tr.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickTour(tr.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-colors ${on ? "border-(--brand-500) bg-(--brand-500)/10 shadow" : "border-(--border-default) bg-(--bg-overlay)"}`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-black ${running ? "bg-emerald-500 text-white" : done ? "bg-(--bg-sunken) opacity-60" : "bg-gradient-brand text-(--brand-contrast)"}`}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black">{tr.secteurName ?? (labels.tourOf ?? "").replace("{n}", String(i + 1))}</span>
                  <span className="block text-[11px] font-bold opacity-60">{tr.stopsCount} {labels.clients}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${running ? "bg-emerald-500/15 text-emerald-600" : done ? "bg-(--bg-sunken)" : "bg-amber-500/15 text-amber-600"}`}>
                  {running ? labels.tourRunning : done ? labels.tourDone : labels.tourWait}
                </span>
              </button>
            );
          })}
        </div>
      )}
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
      <Button onClick={() => void validate()} disabled={busy || (otherRunning && !started && !selFinished)} className="h-14 w-full max-w-xs text-lg">
        {busy ? "…" : started || selFinished ? labels.clients : (
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
