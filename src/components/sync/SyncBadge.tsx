"use client";

import { useEffect, useState } from "react";
import { pendingCount, syncNow, getLastSync, getDeviceToken, shouldAutoSync, AUTO_SYNC_MS } from "@/lib/sync/client";
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
    try {
      setOnline(navigator.onLine);
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
    const on = () => {
      setOnline(true);
      void auto();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
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
          const online = typeof navigator === "undefined" || navigator.onLine !== false;
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
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
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
