"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { notifyDataChanged, onRefreshRequested, setRefreshPending } from "@/lib/data-sync";

/// Writes that must NOT trigger a screen refresh: background pings and auth.
const IGNORE = [
  /^\/api\/track(\/|$)/,
  /^\/api\/auth\//,
  /^\/api\/health/,
  /^\/api\/apk-info/,
  /^\/api\/geo/,
  /^\/api\/distances/,
  /^\/api\/license\//,
  /^\/api\/devices\/self-register/,
  /^\/api\/superadmin\//,
  /^\/api\/uploads/,
  /\/qr-batch$/,
  /\/tournees\/ensure-week$/,
];
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const STALE_MS = 20_000; // refresh on tab/app focus after this long away
const POLL_MS = 60_000; // quiet background refresh while the screen is idle

/// Mounted once (locale layout). Makes every successful save, edit or delete
/// reload the page's data without navigating away:
///  - wraps window.fetch (our own /api writes only) → notify + router.refresh()
///  - refreshes when the window regains focus / becomes visible again
///  - refreshes every minute when idle (other users' changes show up)
///  - F5 / Ctrl+R / Cmd+R do the same soft refresh (no white flash)
export function DataSyncBoot() {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      last = Date.now();
      setRefreshPending(true);
      startTransition(() => {
        router.refresh();
      });
      // router.refresh has no completion callback; the transition settles fast.
      setTimeout(() => setRefreshPending(false), 900);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 120); // coalesce bursts of writes
    };
    const off = onRefreshRequested(schedule);

    // --- fetch wrapper: successful own-origin /api writes ------------------
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      try {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (WRITE.has(method) && res.ok) {
          const raw = input instanceof Request ? input.url : String(input);
          const u = new URL(raw, window.location.origin);
          if (u.origin === window.location.origin && u.pathname.startsWith("/api/") && !IGNORE.some((r) => r.test(u.pathname))) {
            notifyDataChanged();
          }
        }
      } catch {
        /* never break a request because of bookkeeping */
      }
      return res;
    };

    // --- focus / visibility / idle polling --------------------------------
    const busy = () => {
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !(a as HTMLInputElement).readOnly;
      return typing || !!document.querySelector('[role="dialog"], [data-modal-open]');
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > STALE_MS) schedule();
    };
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !busy() && Date.now() - last > POLL_MS - 1000) refresh();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", schedule);

    // --- F5 / Ctrl+R / Cmd+R → soft refresh --------------------------------
    const onKey = (e: KeyboardEvent) => {
      const soft = e.key === "F5" || ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r");
      if (!soft) return;
      e.preventDefault();
      notifyDataChanged();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.fetch = original;
      off();
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", schedule);
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  return null;
}
