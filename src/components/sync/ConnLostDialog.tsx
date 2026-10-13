"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  isServerReachable,
  pendingCount,
  probeReachabilityNow,
  startReachabilityProbe,
  subscribeReachability,
  syncNow,
} from "@/lib/sync/client";

export type ConnLostLabels = {
  title: string;
  hint: string;
  pendingSaved: string;
  continueOffline: string;
  retry: string;
  backOnline: string;
  syncing: string;
};

/// Connection-loss dialog (global, mounted once in the app shell).
/// Fires ONLY on a live ONLINE → OFFLINE transition mid-session — never on
/// first paint when the phone is already offline (the service worker is
/// already serving cache; a popup would be pure noise).
/// One tap on "continue" performs a controlled full-document reload INSIDE
/// the app: the service worker answers from cache (v12+ treats the
/// Cloudflare 530 page as down too), the snapshot + outbox take over, and
/// the driver keeps selling with zero data loss — no app kill, no reopen.
/// On reconnect the dialog closes itself, a toast confirms, queued ops
/// flush, and the pill turns green again. Dismiss (✕) minimizes to the
/// red sync pill; the dialog re-arms for the NEXT outage only.
export function ConnLostDialog({ labels }: { labels: ConnLostLabels }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [toast, setToast] = useState<"online" | null>(null);
  const wasReachable = useRef<boolean | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    startReachabilityProbe();
    try {
      wasReachable.current = isServerReachable();
    } catch {
      wasReachable.current = true;
    }
    const unsub = subscribeReachability((ok) => {
      const was = wasReachable.current;
      wasReachable.current = ok;
      if (!ok && was) {
        // Live transition down: count the queued work, then interrupt.
        pendingCount().then((n) => setPending(n)).catch(() => {});
        setOpen(true);
      } else if (ok && was === false) {
        // Back: close, confirm, flush the queue in the background.
        setOpen(false);
        setRetrying(false);
        setToast("online");
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 4500);
        void syncNow().catch(() => {}).finally(() => {
          pendingCount().then((n) => setPending(n)).catch(() => {});
        });
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

  function goOffline() {
    // Full document load (NOT router.push): client-side transitions need
    // the network for RSC — the worker serves the cached shell instead.
    try {
      window.location.reload();
    } catch {
      setOpen(false);
    }
  }

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      // Reachable again → the subscription above closes + toasts + syncs.
      // Still down → stay open, stop spinning, let the driver continue.
      await probeReachabilityNow();
    } catch {
      /* stay open */
    } finally {
      // If the probe flipped us back the dialog already closed; only
      // release the spinner when we're still looking at it.
      try {
        if (!isServerReachable()) setRetrying(false);
      } catch {
        setRetrying(false);
      }
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={labels.title}
        subtitle={pending > 0 ? `${pending} · ${labels.pendingSaved}` : undefined}
        icon={<WifiOff size={18} />}
        width="sm"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-red-500/10 p-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500">
              <WifiOff size={20} />
            </span>
            <p className="text-[13px] font-bold leading-6">{labels.hint}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void retry()} disabled={retrying} className="flex-1" aria-label={labels.retry}>
              <RefreshCw size={16} className={retrying ? "animate-spin" : ""} />
            </Button>
            <Button onClick={goOffline} className="flex-[2]">
              {labels.continueOffline}
            </Button>
          </div>
        </div>
      </Modal>
      {toast === "online" && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-6">
          <div className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2.5 text-[13px] font-black text-white shadow-2xl">
            <CheckCircle2 size={16} />
            <span>{labels.backOnline} · {labels.syncing}…</span>
          </div>
        </div>
      )}
    </>
  );
}
