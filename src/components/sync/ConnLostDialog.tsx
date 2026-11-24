"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, WifiOff } from "lucide-react";
import {
  isServerReachable,
  startReachabilityProbe,
  subscribeReachability,
  syncNow,
} from "@/lib/sync/client";

export type ConnLostLabels = {
  title: string;
  hint: string;
  pendingSaved: string;
  continueOffline: string;
  switching: string;
  offlineReady: string;
  retry: string;
  backOnline: string;
  syncing: string;
};

/// Handoff flag: set right before an offline reload so the fresh page can greet
/// the driver (kept for pages that still reload on their own).
const SWITCH_FLAG = "dili_offline_switch_v1";

/// Connection-loss handling (global, mounted once in the app shell).
///
/// NO popup and NO reload: when the connection drops mid-session the page the
/// driver is on simply KEEPS RUNNING — everything he selected stays exactly as
/// it is. Sales/orders/etc. are saved on the phone automatically (the screens
/// fall back to the outbox when a request fails) and a small toast says so.
/// Fires ONLY on a live ONLINE → OFFLINE transition (never on first paint when
/// the phone is already offline). When the connection returns, a toast
/// confirms and the queued work is flushed in the background.
export function ConnLostDialog({ labels }: { labels: ConnLostLabels }) {
  const [toast, setToast] = useState<"online" | "offline" | "ready" | null>(null);
  const wasReachable = useRef<boolean | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    startReachabilityProbe();
    const show = (kind: "online" | "offline" | "ready", ms: number) => {
      setToast(kind);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), ms);
    };
    // Greeting after a reload that landed in offline mode (mount gate: the
    // sessionStorage read is client-only so server HTML always matches).
    try {
      const raw = sessionStorage.getItem(SWITCH_FLAG);
      if (raw && Date.now() - Number(raw) < 15000) show("ready", 3000);
      sessionStorage.removeItem(SWITCH_FLAG);
    } catch { /* ignore */ }
    try {
      wasReachable.current = isServerReachable();
    } catch {
      wasReachable.current = true;
    }
    const unsub = subscribeReachability((ok) => {
      const was = wasReachable.current;
      wasReachable.current = ok;
      if (!ok && was) {
        // Live transition down: keep working, just tell him (non-blocking).
        show("offline", 5000);
      } else if (ok && was === false) {
        show("online", 4500);
        void syncNow().catch(() => {});
      }
    });
    return () => {
      unsub();
      if (toastTimer.current) {
        try {
          window.clearTimeout(toastTimer.current);
        } catch { /* ignore */ }
      }
    };
  }, []);

  if (toast === null) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-6" role="status">
      <div
        className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-black text-white shadow-2xl ${toast === "offline" ? "bg-amber-600" : "bg-emerald-600"}`}
      >
        {toast === "offline" ? <WifiOff size={16} /> : <CheckCircle2 size={16} />}
        {toast === "online" ? (
          <span>{labels.backOnline} · {labels.syncing}…</span>
        ) : toast === "offline" ? (
          <span>{labels.offlineReady} · {labels.pendingSaved}</span>
        ) : (
          <span>{labels.offlineReady} ✓</span>
        )}
      </div>
    </div>
  );
}
