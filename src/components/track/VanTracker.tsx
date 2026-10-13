"use client";

import { useEffect } from "react";

/// Key shared with the sync client (src/lib/sync/client.ts): the APK's
/// provisioned device token, persisted from ?device=<token>.
const TOKEN_KEY = "dili_device_token";

const POLL_MS = 30000;
/// Silent heartbeat: regular position every 15min. The driver sees NOTHING —
/// no popup, no toast, no badge. Office requests are answered invisibly.
const HEARTBEAT_MS = 15 * 60 * 1000;

/// Auto GPS reporter for the van APK. Mounted in AppShell on every page but
/// activates ONLY when a device token exists (van phones) — desktop browsers
/// have no token and do nothing.
///
/// Loop (every 30s, fully automatic and SILENT — the driver taps nothing and
/// sees nothing: no popup, no toast, no indicator):
///   1. Ask POST /api/track/pending: "does the office want my position?"
///   2. Power the GPS only when the office requested OR 15min heartbeat elapsed
///   3. POST /api/track { deviceToken, lat, lng, accuracy, speed }
/// A fresh report clears the office's locate request server-side.
export function VanTracker() {
  useEffect(() => {
    let token: string | null = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch { /* private mode */ }
    if (!token) return;

    let stopped = false;
    let lastReport = 0;
    let inFlight = false;

    /// Native-aware fix (Capacitor GPS in the APK — the WebView's own
    /// geolocation never prompts there — browser API on the web).
    async function fix(): Promise<{ lat: number; lng: number; accuracy: number; speedKmh: number | null } | null> {
      try {
        const { getGpsFix } = await import("@/lib/van-gps");
        return await getGpsFix();
      } catch {
        return null;
      }
    }

    async function report(p: { lat: number; lng: number; accuracy: number; speedKmh: number | null }) {
      await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceToken: token,
          lat: p.lat,
          lng: p.lng,
          accuracy: Math.round(p.accuracy ?? 0) || undefined,
          speed: p.speedKmh ?? undefined,
        }),
      }).catch(() => {});
      lastReport = Date.now();
    }

    async function cycle() {
      // NOTE: no document.hidden guard on purpose — a backgrounded van app
      // must still answer locate requests / heartbeat whenever the OS lets
      // the timer fire. The component renders null: fully invisible.
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        let wanted = Date.now() - lastReport > HEARTBEAT_MS;
        if (!wanted) {
          const r = await fetch("/api/track/pending", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceToken: token }),
          }).catch(() => null);
          if (r?.ok) {
            const d = await r.json().catch(() => null);
            wanted = d?.locateRequested === true;
          }
        }
        if (wanted) {
          const p = await fix().catch(() => null);
          if (p && !stopped) await report(p);
        }
      } finally {
        inFlight = false;
      }
    }

    void cycle();
    const id = window.setInterval(() => void cycle(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
