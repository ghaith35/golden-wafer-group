"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    // Desktop serves the bundled app locally and clears old workers before boot.
    if (window.distribuili?.isDesktop) return;
    // The offline shell ("لا يوجد اتصال") exists for the van APK only. Plain web
    // browsers never get a worker; any worker/caches left from earlier visits
    // are removed so that page can never appear on the web.
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    const isApk = !!cap && (typeof cap.isNativePlatform !== "function" || cap.isNativePlatform());
    if ("serviceWorker" in navigator) {
      if (isApk) {
        if (process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
      } else {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => Promise.all(regs.map((r) => r.unregister())))
          .then(() => (typeof caches !== "undefined" ? caches.keys() : []))
          .then((keys) => Promise.all(keys.filter((k) => /^dili|distribuili|workbox/i.test(k)).map((k) => caches.delete(k))))
          .catch(() => {});
      }
    }
    // Self-heal after a server redeploy: cached HTML can reference a rotated
    // JS chunk (404 → ChunkLoadError → "This page couldn't load"). Reload
    // once with a cache-busting flag so the fresh shell loads; the flag
    // prevents a reload loop if the chunk is genuinely missing.
    const onErr = (e: ErrorEvent) => {
      try {
        const msg = String((e as ErrorEvent).message ?? "");
        const filename = String((e as unknown as { filename?: string }).filename ?? "");
        if (!/ChunkLoadError|Loading chunk|failed.*chunk/i.test(`${msg} ${filename}`)) return;
        if (new URLSearchParams(window.location.search).has("dili-chunk-retry")) return;
        const u = new URL(window.location.href);
        u.searchParams.set("dili-chunk-retry", "1");
        window.location.replace(u.toString());
      } catch {
        /* never break the page */
      }
    };
    const onRej = (e: PromiseRejectionEvent) => {
      try {
        const r = e.reason as { name?: string; message?: string } | null;
        const msg = `${r?.name ?? ""} ${r?.message ?? ""}`;
        if (!/ChunkLoadError/i.test(msg)) return;
        e.preventDefault();
        if (new URLSearchParams(window.location.search).has("dili-chunk-retry")) return;
        const u = new URL(window.location.href);
        u.searchParams.set("dili-chunk-retry", "1");
        window.location.replace(u.toString());
      } catch {
        /* never break the page */
      }
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
