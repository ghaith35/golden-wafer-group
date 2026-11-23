"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Battery, Bell, Check, Crosshair, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { missingSteps, tracking, trackingStatus, type Step, type TrackingStatus } from "@/lib/native-tracking";
import { cn } from "@/lib/utils";

/// Key shared with the sync client: the APK's provisioned device token.
const TOKEN_KEY = "dili_device_token";

const ORDER: Step[] = ["fine", "always", "notifications", "battery", "gps"];
const ICON = { fine: MapPin, always: Navigation, notifications: Bell, battery: Battery, gps: Crosshair } as const;

/// First-launch setup of the always-on location service (van phones only).
/// Walks the driver through the Android steps in order — precise location,
/// "allow all the time", notifications, no battery limit, GPS on — and keeps a
/// full-screen page up until every one is done. Then it starts the native
/// service, which answers the office's "request location" within seconds and
/// reports by itself even with the app closed. Does nothing on the web, on
/// phones without a device token, or in an older APK without the service.
export function TrackingGate() {
  const t = useTranslations("trackingGate");
  const [st, setSt] = useState<TrackingStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<Step | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let tk: string | null = null;
    try {
      tk = localStorage.getItem(TOKEN_KEY);
    } catch { /* private mode */ }
    if (!tk) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time read of the device token
    setToken(tk);

    async function refresh() {
      const s = await trackingStatus();
      if (!alive || !s) return;
      setSt(s);
      // Everything granted: start (idempotent) so the service owns the reporting.
      if (missingSteps(s).length === 0 && tk) {
        if (!startedRef.current || !s.enabled) {
          startedRef.current = true;
          const r = await tracking.start(window.location.origin, tk);
          if (alive && r) setSt(r);
        }
      }
    }
    void refresh();
    // Back from a Settings screen: re-check at once; otherwise a slow beat.
    const onVis = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const id = window.setInterval(() => void refresh(), 2500);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  if (!token || !st) return null;
  const missing = missingSteps(st);
  if (missing.length === 0) return null;

  const steps = ORDER.filter((s) => s !== "notifications" || st.sdk >= 33);
  const current = missing[0];
  const done = steps.length - missing.length;

  async function act(step: Step) {
    if (busy) return;
    setBusy(step);
    try {
      const r =
        step === "fine" ? await tracking.requestFine()
        : step === "always" ? await tracking.requestAlways()
        : step === "notifications" ? await tracking.requestNotifications()
        : step === "battery" ? await tracking.requestBattery()
        : await tracking.openLocationSettings();
      if (r) setSt(r);
    } finally {
      setBusy(null);
    }
  }

  const brandHint = /xiaomi|redmi|poco|huawei|honor|oppo|realme|oneplus|vivo|samsung/.test(st.manufacturer);

  return (
    <div className="fixed inset-0 z-[120] flex flex-col overflow-y-auto bg-(--bg-page) p-5 pb-8" role="dialog" aria-modal="true" aria-label={t("title")}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5">
        <div className="flex flex-col items-center gap-3 pt-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand text-(--brand-contrast) shadow-lg">
            <ShieldCheck size={32} />
          </span>
          <h1 className="text-xl font-black">{t("title")}</h1>
          <p className="text-sm font-bold leading-relaxed opacity-70">{t("intro")}</p>
        </div>

        {/* progress */}
        <div className="h-2 overflow-hidden rounded-full bg-(--bg-sunken)" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length}>
          <div className="h-full rounded-full bg-gradient-brand transition-all duration-500" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
        </div>

        <ol className="flex flex-col gap-2.5">
          {steps.map((s) => {
            const ok = !missing.includes(s);
            const cur = s === current;
            const Icon = ICON[s];
            return (
              <li key={s} className={cn("rounded-2xl border p-3.5 transition-colors", ok ? "border-emerald-500/40 bg-emerald-500/5" : cur ? "border-(--brand-500) bg-(--bg-overlay) shadow-lg" : "border-(--border-default) bg-(--bg-overlay) opacity-70")}>
                <div className="flex items-center gap-3">
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", ok ? "bg-emerald-500 text-white" : cur ? "bg-gradient-brand text-(--brand-contrast)" : "bg-(--bg-sunken)")}>
                    {ok ? <Check size={20} strokeWidth={3} /> : <Icon size={20} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black">{t(`${s}Title`)}</p>
                    {(cur || ok) && <p className="text-xs font-bold leading-snug opacity-70">{ok ? t("done") : t(`${s}Hint`)}</p>}
                  </div>
                </div>
                {cur && (
                  <button
                    type="button"
                    onClick={() => void act(s)}
                    disabled={busy !== null}
                    className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-brand text-base font-black text-(--brand-contrast) shadow active:scale-[0.98] disabled:opacity-60"
                  >
                    {busy === s ? "…" : t(`${s}Button`)}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {brandHint && <p className="rounded-xl bg-amber-500/10 p-3 text-xs font-bold leading-relaxed text-amber-700">{t("brandHint")}</p>}

        <button type="button" onClick={() => void tracking.openAppSettings()} className="mx-auto text-xs font-black underline opacity-70">
          {t("openSettings")}
        </button>
      </div>
    </div>
  );
}
