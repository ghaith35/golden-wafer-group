"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, CheckCircle2, Loader2, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import {
  AUTO_SYNC_MS,
  discardOutboxOp,
  failedOps,
  getDeviceToken,
  getLastSync,
  isNative,
  isServerReachable,
  pendingCount,
  retryOutboxOp,
  setDeviceToken,
  setVanId,
  shouldAutoSync,
  subscribeReachability,
  syncNow,
  type SyncPhase,
} from "@/lib/sync/client";
import { cn } from "@/lib/utils";

export type SyncBadgeLabels = {
  offline: string; pending: string; sync: string; synced: string; noDevice: string;
  upload: string; download: string; images: string;
  applied: string; failed: string; remaining: string;
  retry: string; failedOps: string;
  pairing: string; pairFail: string; syncOk: string; syncNow: string;
};

type Step = { label: string; state: "active" | "done" | "error"; detail: string };

/// TopBar sync pill AND mini sync-center (staff: Vendeur + Livreur).
/// One tap runs the EXACT sync-section flow — silent auto-pair when the
/// phone has no device yet, phased upload/download/images progress, result
/// counts, failed-ops repair — inside a dropdown panel, no navigation.
/// Fresh APK drivers (no token yet) also see the pill: it's their pairing
/// entry. Desktop admins without a device keep seeing nothing (as before).
export function SyncBadge({ labels }: { labels: SyncBadgeLabels }) {
  // Default online: server renders the same, the true state syncs on mount
  // (reading navigator during render mismatches hydration when offline).
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [showPill, setShowPill] = useState(false);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pct, setPct] = useState(0);
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<{ applied: number; failed: number; remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Array<{ opId: string; kind: string; error?: string }>>([]);
  const runId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    // Server truth, not the browser flag: wifi-on/server-dead must read
    // red here too, or the pill claims "synced" while staring at Error 1033.
    // Mount-gate (server HTML defaults online so hydration always matches).
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount gate, see above
      setOnline(isServerReachable());
    } catch { /* assume online */ }
    const refresh = async () => {
      if (!live) return;
      let token = false;
      try {
        token = !!getDeviceToken();
      } catch { /* ignore */ }
      setPending(await pendingCount());
      setLast(getLastSync());
      // Fresh APK driver (no token, nothing queued): the pill is his
      // pairing entry — tapping it pairs + syncs like the Sync section.
      let native = false;
      try {
        native = isNative();
      } catch { /* ignore */ }
      if (live) setShowPill(token || native || (await pendingCount().catch(() => 0)) > 0);
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
      if (closeTimer.current) {
        try {
          window.clearTimeout(closeTimer.current);
        } catch { /* ignore */ }
      }
    };
  }, []);

  // Outside tap / Escape closes the panel (mirrors the user menu).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  function setStep(label: string, state: Step["state"], detail = "") {
    setSteps((ss) => {
      const i = ss.findIndex((s) => s.label === label);
      const row = { label, state, detail };
      return i >= 0 ? ss.map((s, j) => (j === i ? row : s)) : [...ss, row];
    });
  }

  /// First-scan zero-touch (mirrors the Sync section): a logged-in driver
  /// with no device token gets silently paired to his own van, then the
  /// full sync starts — one tap is enough for 100% offline use.
  async function ensurePaired(): Promise<boolean> {
    try {
      if (getDeviceToken()) return true;
    } catch { /* fall through to pairing */ }
    setPairing(true);
    try {
      const res = await fetch("/api/devices/self-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.token) return false;
      setDeviceToken(d.token);
      if (d.vanId) {
        try {
          setVanId(d.vanId);
        } catch { /* ignore */ }
      }
      if (liveRef.current) setShowPill(true);
      return true;
    } catch {
      return false;
    } finally {
      setPairing(false);
    }
  }

  /// The sync-section run, in the pill: phased progress, result counts,
  /// failed-ops repair. Concurrent taps join the single flight (syncNow is
  /// single-flight internally) instead of duplicating documents.
  async function start() {
    if (running) return;
    const id = ++runId.current;
    const alive = () => runId.current === id;
    if (closeTimer.current) {
      try {
        window.clearTimeout(closeTimer.current);
      } catch { /* ignore */ }
      closeTimer.current = null;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setSteps([]);
    setPct(2);
    try {
      const paired = await ensurePaired();
      if (!alive()) return;
      if (!paired) {
        setError(labels.pairFail);
        setRunning(false);
        return;
      }
      const res = await syncNow((p: SyncPhase) => {
        if (!alive()) return;
        if (p.phase === "prepare") {
          setStep(labels.upload, "active", `${p.total}`);
          setPct(5);
        } else if (p.phase === "upload") {
          setStep(labels.upload, "active", `${p.sent}`);
          setPct(10 + Math.round(35 * (p.total ? p.sent / Math.max(1, p.total) : 1)));
        } else if (p.phase === "apply") {
          setStep(labels.upload, p.done >= p.total ? "done" : "active", `${p.done}/${p.total}`);
          setPct(45 + Math.round(20 * (p.total ? p.done / Math.max(1, p.total) : 1)));
        } else if (p.phase === "download") {
          setStep(labels.upload, "done", "");
          setStep(labels.download, "done", `${p.products}+${p.clients}`);
          setPct(70);
        } else if (p.phase === "images") {
          setStep(labels.images, p.done >= p.total ? "done" : "active", p.total ? `${p.done}/${p.total}` : "");
          setPct(70 + Math.round(28 * (p.total ? p.done / Math.max(1, p.total) : 1)));
        } else if (p.phase === "done") {
          setSteps((ss) => ss.map((s) => ({ ...s, state: "done" as const })));
          setPct(100);
          setResult({ applied: p.applied, failed: p.failed, remaining: p.remaining });
        }
      });
      void res;
      if (alive()) {
        setPending(await pendingCount().catch(() => 0));
        setLast(getLastSync());
        setFailed(await failedOps().catch(() => []));
        // Clean run, nothing left: confirm briefly, then vanish.
        const clean =
          (await pendingCount().catch(() => 0)) === 0 &&
          (await failedOps().catch(() => [])).length === 0;
        if (clean) {
          closeTimer.current = window.setTimeout(() => {
            if (runId.current === id) setOpen(false);
          }, 2200);
        }
      }
    } catch (e) {
      if (!alive()) return;
      setError(e instanceof Error ? e.message : "sync_failed");
      setSteps((ss) => ss.map((s) => (s.state === "active" ? { ...s, state: "error" as const } : s)));
    } finally {
      if (alive()) {
        setRunning(false);
        setPending(await pendingCount().catch(() => 0));
        setLast(getLastSync());
      }
    }
  }

  async function repair(opId: string) {
    try {
      await retryOutboxOp(opId);
      setFailed(await failedOps().catch(() => []));
      void start();
    } catch { /* stays listed */ }
  }

  async function discard(opId: string) {
    try {
      await discardOutboxOp(opId);
      setFailed(await failedOps().catch(() => []));
      setPending(await pendingCount().catch(() => 0));
    } catch { /* stays listed */ }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // Opening the panel IS the sync tap: a fresh panel auto-runs, exactly
    // like pressing "sync" in the Sync section. Re-taps re-run.
    if (next && !running) {
      setError(null);
      setResult(null);
      void start();
    }
  }

  // Desktop web without a device token: nothing to sync.
  if (!showPill) return null;

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={last ? `${labels.synced}: ${new Date(last).toLocaleString()}` : labels.noDevice}
        className={cn(
          "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
          !online ? "bg-red-500/15 text-red-500" : running ? "bg-(--brand-500)/15 text-(--brand-600)" : pending > 0 ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/15 text-emerald-600"
        )}
      >
        {running || pairing ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <RefreshCw size={13} />
        )}
        <span>
          {!online
            ? `● ${labels.offline}${pending > 0 ? ` · ${pending}` : ""}`
            : running
              ? `${pct}%`
              : pending > 0
                ? `● ${pending} ${labels.pending}`
                : `● ${labels.sync}`}
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={labels.sync}
          className="absolute start-0 top-[calc(100%+8px)] z-50 w-72 max-w-[92vw] overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 shadow-2xl"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--brand-500)/10 text-(--brand-600)">
              <ArrowDownUp size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-black">{labels.sync}</div>
              <div className="truncate text-[10px] opacity-60" dir="ltr">
                {last ? `${labels.synced}: ${new Date(last).toLocaleString()}` : labels.noDevice}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-(--border-default) opacity-70 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-(--bg-sunken)">
            <div className="h-full rounded-full bg-(--brand-500) transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          {pairing && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-bold opacity-70">
              <Loader2 size={13} className="animate-spin" /> {labels.pairing}…
            </p>
          )}
          {steps.length > 0 && (
            <div className="mt-2 space-y-1">
              {steps.map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-xs">
                  <span className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    s.state === "done" ? "bg-emerald-500/15 text-emerald-500"
                    : s.state === "error" ? "bg-red-500/15 text-red-500"
                    : "bg-(--brand-500)/10 text-(--brand-600)"
                  )}>
                    {s.state === "done" ? <CheckCircle2 size={13} /> : s.state === "error" ? <X size={13} /> : <Loader2 size={13} className="animate-spin" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold">{s.label}</span>
                  {s.detail !== "" && (
                    <span className="shrink-0 font-black tabular-nums opacity-60" dir="ltr">{s.detail}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {result && (
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-black text-emerald-600">
              <CheckCircle2 size={14} />
              <span dir="ltr">{result.applied} ✓</span>
              {result.failed > 0 && <span dir="ltr">· {result.failed} {labels.failed}</span>}
              {result.remaining > 0 && <span dir="ltr">· {result.remaining} {labels.remaining}</span>}
              {result.failed === 0 && result.remaining === 0 && <span>{labels.syncOk}</span>}
            </div>
          )}
          {error && (
            <p className="mt-2 rounded-xl bg-red-500/10 p-2 text-xs font-bold text-red-500" dir="ltr">{error}</p>
          )}
          {failed.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] font-black uppercase opacity-60">{labels.failedOps} ({failed.length})</div>
              {failed.slice(0, 5).map((f) => (
                <div key={f.opId} className="flex items-center gap-1.5 rounded-lg bg-(--bg-sunken) px-2 py-1.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-bold" dir="ltr">{f.kind}</span>
                  <button
                    type="button"
                    onClick={() => void repair(f.opId)}
                    aria-label={labels.retry}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-(--brand-500)/10 text-(--brand-600)"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void discard(f.opId)}
                    aria-label="discard"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => void start()}
            disabled={running || pairing}
            className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-(--brand-500) text-sm font-black text-(--brand-contrast) disabled:opacity-50"
          >
            {running || pairing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {labels.syncNow}
          </button>
        </div>
      )}
    </div>
  );
}
