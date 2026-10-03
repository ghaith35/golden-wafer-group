"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { checkGpsPermission, requestGpsPermission, type GpsPerm } from "@/lib/gps-permission";

/// Start-of-day gate: live clock + validate to stamp départ, then clients.
export function StartClient({
  locale,
  day,
  dateIso,
  vanName,
  tourneeId,
  startedAt,
  labels,
}: {
  locale: string;
  day: string;
  dateIso: string;
  vanName: string;
  tourneeId: string | null;
  startedAt: string | null;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string | null>(startedAt);
  /// Location permission state (asked once here, then lazily per feature).
  const [gps, setGps] = useState<GpsPerm | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    checkGpsPermission().then(setGps).catch(() => {});
    return () => window.clearInterval(id);
  }, []);

  const date = new Date(dateIso);

  async function validate() {
    if (started) {
      router.push(`/${locale}/livreur/${day}`);
      return;
    }
    // Ask for location first (system popup) — but never block the day:
    // denial only disables tracking, stamped below.
    if (gps !== "granted" && gps !== "denied") {
      setGps(await requestGpsPermission().catch(() => "prompt" as GpsPerm));
    }
    if (tourneeId) {
      setBusy(true);
      try {
        const res = await fetch(`/api/tournees/${tourneeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        if (res.ok) {
          const d = await res.json();
          setStarted(d.startedAt ?? new Date().toISOString());
        }
      } catch { /* offline — continue anyway */ } finally {
        setBusy(false);
      }
    }
    router.push(`/${locale}/livreur/${day}`);
  }

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 p-5 text-center">
      <button
        aria-label="back"
        onClick={() => router.push(`/${locale}/livreur`)}
        className="absolute start-4 top-4 flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default)"
      >
        <ArrowLeft size={18} className="rtl:rotate-180" />
      </button>
      <p className="text-lg font-black">
        {date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <p className="text-xs font-bold opacity-60">{vanName}</p>
      <p className="font-mono text-6xl font-black tabular-nums" dir="ltr">
        {now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
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
