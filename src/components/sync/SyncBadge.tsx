"use client";

import { useEffect, useState } from "react";
import { isServerReachable, pendingCount, subscribeReachability, syncNow, getLastSync, getDeviceToken, shouldAutoSync, AUTO_SYNC_MS } from "@/lib/sync/client";
import { cn } from "@/lib/utils";

/// Offline/sync status pill: online state, pending ops, last sync, manual sync.
export function SyncBadge({ labels }: { labels: { offline: string; pending: string; sync: string; synced: string; noDevice: string } }) {
  // Default online: server renders the same, the true state syncs on mount
  // (reading navigator during render mismatches hydration when offline).
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    let live = true;
    // Server truth, not the browser flag: wifi-on/server-dead must read
    // red here too, or the pill claims "synced" while staring at Error 1033.
    try {
      setOnline(isServerReachable());
    } catch { /* assume online */ }
    const refresh = async () => {
      if (!live) return;
      setHasToken(!!getDeviceToken());
      setPending(await pendingCount());
      setLast(getLastSync());
    };
    void refresh();
    let busyRef = false;
    const auto = async () => {
      // Reconnected with queued ops → flush automatically.
      if (busyRef || (await pendingCount()) === 0) return;
      busyRef = true;
      try {
        await syncNow();
        await refresh();
      } catch {
        /* stays queued */
      } finally {
        busyRef = false;
      }
    };
    // Server truth drives the pill + the auto-flush (tunnel-down with
    // wifi on must go red and stay quiet here too). The browser events
    // stay as a fast path — the probe confirms right after.
    const onReach = (ok: boolean) => {
      if (!live) return;
      setOnline(ok);
      if (ok) void auto();
    };
    const unsub = subscribeReachability(onReach);
    const onWin = () => {
      try {
        setOnline(isServerReachable());
      } catch { /* ignore */ }
    };
    window.addEventListener("online", onWin);
    window.addEventListener("offline", onWin);
    const t = setInterval(() => {
      void refresh();
    }, 5000);
    // Heartbeat: every 30s flush without being asked — but ONLY with
    // something to send, a device, a connection and a visible page.
    // Offline (or hidden, or idle) the tick resolves locally and stops:
    // no timers pile up, no battery burn, syncNow never fires blind.
    const beat = setInterval(() => {
      void (async () => {
        try {
          const hidden = typeof document !== "undefined" && document.hidden;
          let online = typeof navigator === "undefined" || navigator.onLine !== false;
          try {
            // Server truth gates the flush: hammering a dead tunnel with
            // the outbox only quarantines good ops behind doomed retries.
            online = online && isServerReachable();
          } catch { /* keep the browser flag */ }
          let token = false;
          try {
            token = !!getDeviceToken();
          } catch { /* ignore */ }
          const pending = await pendingCount().catch(() => 0);
          if (!shouldAutoSync({ hidden, online, busy: busyRef, hasToken: token, pending })) return;
          await auto();
        } catch {
          /* never break the page */
        }
      })();
    }, AUTO_SYNC_MS);
    return () => {
      live = false;
      unsub();
      window.removeEventListener("online", onWin);
      window.removeEventListener("offline", onWin);
      clearInterval(t);
      clearInterval(beat);
    };
  }, []);

  async function run() {
    setBusy(true);
    try {
      await syncNow();
      setPending(await pendingCount());
      setLast(getLastSync());
    } catch {
      /* stays queued */
    } finally {
      setBusy(false);
    }
  }

  // Desktop web without a device token: nothing to sync.
  if (!hasToken && pending === 0) return null;

  return (
    <button
      onClick={run}
      disabled={busy}
      title={last ? `${labels.synced}: ${new Date(last).toLocaleString()}` : labels.noDevice}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
        !online ? "bg-red-500/15 text-red-500" : pending > 0 ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/15 text-emerald-600"
      )}
    >
      <span>{!online ? `● ${labels.offline}${pending > 0 ? ` · ${pending}` : ""}` : pending > 0 ? `● ${pending} ${labels.pending}` : `● ${labels.sync}`}</span>
    </button>
  );
}
