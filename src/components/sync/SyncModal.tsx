"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { syncNow, prepareOfflinePages, getDeviceToken, failedOps, retryOutboxOp, discardOutboxOp, getVanSnapshot, getOfflineCred, getClockSkew, setDeviceToken, setVanId, type SyncPhase, type WebUpdateInfo } from "@/lib/sync/client";
import { applyWebUpdate } from "@/lib/sync/web-update";
import type { OutboxRow } from "@/lib/sync/offline-db";
import { DeviceSetup } from "@/components/sync/DeviceSetup";
import { UpdateChecker } from "@/components/sync/UpdateChecker";
import { loadHistory, clearHistory, type SyncHistoryEntry } from "@/lib/sync/history";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type StepState = { label: string; state: "idle" | "active" | "done" | "error"; detail: string };

/// Display locale with Latin digits: Arabic month names (أكتوبر…) but
/// Western numerals (12 not ١٢) — same for fr/en (their months + Latin digits).
function displayLocale(): string {
  try {
    const l = document.documentElement.lang || "ar";
    return l.includes("nu-") ? l : `${l}-u-nu-latn`;
  } catch {
    return "ar-u-nu-latn";
  }
}

/// Sync popup: both directions with a progress bar —
/// 📤 phone → logiciel (outbox ops) then 📥 logiciel → phone (snapshot + images).
export function SyncModal({
  open,
  offlinePages,
  onClose,
  onDone,
  labels,
}: {
  open: boolean;
  offlinePages: { locale: string; day: string; role: string };
  onClose: () => void;
  onDone?: () => void;
  labels: Record<string, string>;
}) {
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [result, setResult] = useState<{ applied: number; failed: number; remaining: number } | null>(null);
  /// New web build pulled with this sync — user validates → restart updated.
  const [webUpdate, setWebUpdate] = useState<WebUpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// No device token (fresh phone) → setup mode first, then first sync.
  const [hasToken, setHasToken] = useState(false);
  /// Past syncs (what each one did, exactly).
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  /// Ops the server rejected — visible until repaired or discarded.
  const [failed, setFailed] = useState<OutboxRow[]>([]);
  const [showHist, setShowHist] = useState(false);
  const [openHist, setOpenHist] = useState<number | null>(null);
  /// First-scan zero-touch: pair + full sync ran automatically this open.
  const autoRan = useRef(false);
  /// Offline readiness: snapshot + credential + device token cached.
  const [ready, setReady] = useState({ snap: false, cred: false, token: false });
  /// Phone-clock skew flagged by the last sync (misdates offline sales).
  const [skew, setSkew] = useState<number | null>(null);
  const runId = useRef(0);

  async function refreshReadiness() {
    try {
      const [snap, cred, sk] = await Promise.all([
        getVanSnapshot().catch(() => null),
        Promise.resolve(getOfflineCred()),
        getClockSkew().catch(() => null),
      ]);
      let token = false;
      try {
        token = !!getDeviceToken();
      } catch {
        token = false;
      }
      setReady({ snap: !!snap, cred: !!cred, token });
      setSkew(sk ? sk.skewMin : null);
    } catch {
      /* best-effort */
    }
  }

  /// First-scan flow: a logged-in driver opening Sync with no device token
  /// gets silently paired (his own van — server-enforced) and a full sync
  /// starts on its own, so one scan is enough for 100% offline use.
  /// Anything else (desktop admin, no van, offline) falls back to the manual
  /// setup exactly as before.
  async function silentPairAndSync() {
    if (autoRan.current) return;
    autoRan.current = true;
    try {
      const res = await fetch("/api/devices/self-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.token) return;
      setDeviceToken(d.token);
      if (d.vanId) {
        try {
          setVanId(d.vanId);
        } catch {
          /* ignore */
        }
      }
      setHasToken(true);
      await refreshReadiness();
      await start();
    } catch {
      /* offline or unpaired: manual setup stays */
    }
  }

  useEffect(() => {
    if (open) {
      setPct(0);
      setSteps([]);
      setResult(null);
      setWebUpdate(null);
      setUpdating(false);
      setError(null);
      setRunning(false);
      setShowHist(false);
      setOpenHist(null);
      autoRan.current = false;
      let paired = false;
      try {
        paired = !!getDeviceToken();
      } catch {
        paired = false;
      }
      setHasToken(paired);
      loadHistory().then(setHistory).catch(() => {});
      failedOps().then(setFailed).catch(() => {});
      void refreshReadiness();
      // First-scan zero-touch: pair + full sync without any tap.
      if (!paired) void silentPairAndSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  function setStep(label: string, state: StepState["state"], detail = "") {
    setSteps((ss) => {
      const i = ss.findIndex((s) => s.label === label);
      const row = { label, state, detail };
      return i >= 0 ? ss.map((s, j) => (j === i ? row : s)) : [...ss, row];
    });
  }

  async function start() {
    if (running) return;
    const id = ++runId.current;
    setRunning(true);
    setError(null);
    setResult(null);
    setWebUpdate(null);
    setSteps([]);
    setPct(2);
    const alive = () => runId.current === id;
    try {
      let summary: typeof result = null;
      const res = await syncNow((p: SyncPhase) => {
        if (!alive()) return;
        if (p.phase === "prepare") {
          setStep(labels.upload ?? "upload", "active", `${p.total}`);
          setPct(5);
        } else if (p.phase === "upload") {
          setStep(labels.upload ?? "upload", "active", `${p.sent}`);
          setPct(10 + Math.round(35 * (p.total ? p.sent / Math.max(1, p.total) : 1)));
        } else if (p.phase === "apply") {
          setStep(labels.upload ?? "upload", p.done >= p.total ? "done" : "active", `${p.done}/${p.total}`);
          setPct(45 + Math.round(20 * (p.total ? p.done / Math.max(1, p.total) : 1)));
        } else if (p.phase === "download") {
          setStep(labels.upload ?? "upload", "done", "");
          setStep(labels.download ?? "download", "done", `${p.products}+${p.clients}`);
          setPct(70);
        } else if (p.phase === "images") {
          setStep(labels.images ?? "images", p.done >= p.total ? "done" : "active", p.total ? `${p.done}/${p.total}` : "");
          setPct(70 + Math.round(20 * (p.total ? p.done / Math.max(1, p.total) : 1)));
        } else if (p.phase === "done") {
          setSteps((ss) => ss.map((s) => ({ ...s, state: "done" as const })));
          summary = { applied: p.applied, failed: p.failed, remaining: p.remaining };
        }
      });
      if (!alive()) return;
      const pageLabel = labels.pages ?? "Pages";
      setStep(pageLabel, "active");
      setPct(92);
      const { locale, day, role } = offlinePages;
      const pages = await prepareOfflinePages(locale, day, role);
      if (!alive()) return;
      const saved = pages.filter((page) => page.ok).length;
      const ready = saved === pages.length;
      setStep(pageLabel, ready ? "done" : "error", `${saved}/${pages.length}`);
      if (ready) setPct(100);
      setResult(summary);
      onDone?.();
      if (res.webUpdate?.available) setWebUpdate(res.webUpdate);
    } catch (e) {
      if (!alive()) return;
      setError(e instanceof Error ? e.message : "sync_failed");
      setSteps((ss) => ss.map((s) => (s.state === "active" ? { ...s, state: "error" as const } : s)));
    } finally {
      if (alive()) {
        setRunning(false);
        loadHistory().then(setHistory).catch(() => {});
        failedOps().then(setFailed).catch(() => {});
        void refreshReadiness();
      }
    }
  }

  async function retryFailed(opId: string) {
    await retryOutboxOp(opId);
    setFailed(await failedOps());
    void start();
  }
  async function discardFailed(opId: string) {
    await discardOutboxOp(opId);
    setFailed(await failedOps());
    void refreshReadiness();
  }

  /// User validated the pulled update: restart into it (outbox + snapshot
  /// are durable, nothing is lost by the reload).
  async function validateWeb() {
    if (!webUpdate || updating) return;
    setUpdating(true);
    try {
      await applyWebUpdate(webUpdate.buildId);
    } finally {
      setUpdating(false);
    }
  }

  const setupLabels = {
    setupHint: labels.serverScanHint ?? labels.setupHint, scanSetup: labels.scanSetup, manual: labels.manual,
    gallery: labels.gallery, qrNotFound: labels.qrNotFound, invalidQr: labels.invalidQr,
    tokenPh: labels.tokenPh, urlPh: labels.urlPh, tokenRequired: labels.tokenRequired,
    saveConfig: labels.saveConfig,
    camNeedHttps: labels.camNeedHttps, camDenied: labels.camDenied, camUnsupported: labels.camUnsupported,
    directSync: labels.directSync, noVan: labels.noVan,
  };

  return (
    <Modal open={open} onClose={onClose} title={labels.title ?? "sync"} icon={<ArrowDownUp size={18} />} width="sm">
      {!hasToken ? (
        <DeviceSetup
          compact
          onConfigured={() => setHasToken(true)}
          labels={setupLabels}
        />
      ) : (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2 text-[11px] font-black">
          <span className="opacity-70">{labels.offlineReady ?? "offline"}</span>
          <span className="flex gap-1.5 tabular-nums" dir="ltr">
            <span className={ready.snap ? "text-emerald-600" : "text-red-500"}>data {ready.snap ? "✓" : "✗"}</span>
            <span className={ready.cred ? "text-emerald-600" : "text-red-500"}>login {ready.cred ? "✓" : "✗"}</span>
            <span className={ready.token ? "text-emerald-600" : "text-red-500"}>phone {ready.token ? "✓" : "✗"}</span>
          </span>
        </div>
        {!ready.snap || !ready.cred || !ready.token ? (
          <p className="rounded-xl bg-amber-500/10 p-2 text-[11px] font-bold text-amber-600">{labels.offlineNotReady ?? ""}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5 text-center text-xs font-black">
          <div className="rounded-xl bg-(--bg-sunken) px-2 py-2">
            <div className="text-base">📤</div>
            <div className="opacity-60">{labels.up ?? ""}</div>
          </div>
          <div className="rounded-xl bg-(--bg-sunken) px-2 py-2">
            <div className="text-base">📥</div>
            <div className="opacity-60">{labels.down ?? ""}</div>
          </div>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-(--bg-sunken)">
          <div
            className={cn("h-full rounded-full transition-all", error ? "bg-red-500" : pct >= 100 ? "bg-emerald-500" : "bg-(--brand-500)")}
            style={{ width: `${pct}%` }}
          />
        </div>
        {steps.length > 0 && (
          <div className="space-y-1">
            {steps.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-2 text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <span>{s.state === "done" ? "✅" : s.state === "active" ? "⏳" : s.state === "error" ? "❌" : "·"}</span>
                  <span className={cn(s.state === "error" && "text-red-500")}>{s.label}</span>
                </span>
                {s.detail && <span className="tabular-nums opacity-60" dir="ltr">{s.detail}</span>}
              </div>
            ))}
          </div>
        )}
        {result && (
          <div className="flex flex-wrap gap-1.5 text-xs font-black">
            <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-600">
              {labels.applied ?? "ok"}: <bdi>{result.applied}</bdi>
            </span>
            {result.failed > 0 && (
              <span className="rounded-lg bg-red-500/10 px-2 py-1 text-red-500">
                {labels.failed ?? "failed"}: <bdi>{result.failed}</bdi>
              </span>
            )}
            <span className="rounded-lg bg-(--bg-sunken) px-2 py-1 opacity-70">
              {labels.remaining ?? "left"}: <bdi>{result.remaining}</bdi>
            </span>
          </div>
        )}
        {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
        {skew != null && (
          <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600" dir="auto">
            ⏰ {labels.clockSkew ?? "Phone clock is off — fix the time, then sync again."} ({skew > 0 ? "+" : ""}{skew} min)
          </p>
        )}
        {webUpdate?.available && (
          <div className="rounded-2xl border border-(--brand-500) bg-(--brand-500)/5 p-3">
            <div className="mb-1 text-sm font-black">⬆️ {labels.webUpdateTitle ?? labels.webNew ?? "update"}</div>
            {webUpdate.nativeRequired ? (
              <div className="space-y-2">
                <p className="text-[11px] font-bold opacity-70">{labels.nativeTitle ?? ""}</p>
                <a href="/apk/Distribuili-Van.apk" download="Golden-Wafer-Group.apk" className="flex h-11 items-center justify-center rounded-xl bg-(--brand-500) px-4 text-sm font-black text-(--brand-contrast)">
                  {labels.nativeGo ?? labels.downloadApk ?? "download"}
                </a>
              </div>
            ) : (
              <div className="flex gap-2">
                {!webUpdate.force && (
                  <Button variant="secondary" onClick={() => setWebUpdate(null)} className="flex-1" disabled={updating}>
                    {labels.webLater ?? labels.close ?? "later"}
                  </Button>
                )}
                <Button onClick={() => void validateWeb()} disabled={updating} className="flex-[2]">
                  {updating ? "…" : (labels.webValidate ?? labels.updateNow ?? "update")}
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1" disabled={running}>
            {labels.close ?? "close"}
          </Button>
          <Button onClick={() => void start()} disabled={running} data-testid="sync-start" className="flex-[2]">
            {running ? `${pct}%` : (labels.start ?? "sync")}
          </Button>
        </div>
      </div>
      )}
      {hasToken && (
        <UpdateChecker
          labels={{
            updateTitle: labels.updateTitle, checkUpdate: labels.checkUpdate,
            webOk: labels.webOk, webNew: labels.webNew, updateNow: labels.updateNow,
            download: labels.downloadApk, apkHint: labels.apkHint,
          }}
        />
      )}
      {hasToken && failed.length > 0 && (
        <div className="border-t border-(--border-subtle) pt-2">
          <div className="mb-1.5 text-xs font-black text-red-500">
            ⚠️ {labels.failed ?? "failed"} ({failed.length})
          </div>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {failed.map((o) => (
              <div key={o.opId} className="rounded-xl bg-red-500/5 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                  <span className="font-mono" dir="ltr">{o.kind}</span>
                  <span className="truncate text-red-500" dir="ltr">{o.error}</span>
                </div>
                <div className="mt-1 flex gap-1.5">
                  <Button variant="secondary" onClick={() => void retryFailed(o.opId)} className="h-8 flex-1 px-2 text-[11px]">
                    ↻ {labels.retry ?? "retry"}
                  </Button>
                  <Button variant="secondary" onClick={() => void discardFailed(o.opId)} className="h-8 flex-1 px-2 text-[11px]">
                    ✕ {labels.discard ?? "discard"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {hasToken && (
        <div className="border-t border-(--border-subtle) pt-2">
          <button
            type="button"
            onClick={() => setShowHist((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-black opacity-70"
          >
            <span>🕘 {labels.history ?? "history"} ({history.length})</span>
            <span>{showHist ? "▾" : "▸"}</span>
          </button>
          {showHist && (
            <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto">
              {history.length === 0 && (
                <p className="text-[11px] opacity-60">{labels.noHistory ?? "—"}</p>
              )}
              {history.map((h, i) => (
                <div key={`${h.ts}-${i}`} className="rounded-xl bg-(--bg-sunken) px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setOpenHist(openHist === i ? null : i)}
                    className="flex w-full items-center justify-between gap-2 text-[11px] font-bold"
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{h.ok ? "✅" : "❌"}</span>
                      <span className="tabular-nums" dir="ltr">
                        {new Date(h.ts).toLocaleDateString(displayLocale(), { day: "numeric", month: "short" })}{" "}
                        {new Date(h.ts).toLocaleTimeString(displayLocale(), { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums opacity-70" dir="ltr">
                      ↑{h.applied}{h.failed > 0 ? ` ✗${h.failed}` : ""} ↓{h.products + h.clients}
                    </span>
                  </button>
                  {openHist === i && (
                    <div className="mt-1.5 space-y-0.5 border-t border-(--border-default) pt-1.5 text-[11px] tabular-nums opacity-80">
                      <div className="flex justify-between"><span>{labels.up ?? ""}</span><span dir="ltr">{h.uploaded} → {h.applied} ok{h.failed > 0 ? `, ${h.failed} failed` : ""}</span></div>
                      {Object.entries(h.kinds ?? {}).map(([k, n]) => (
                        <div key={k} className="flex justify-between"><span className="font-mono" dir="ltr">{k}</span><span dir="ltr">×{n}</span></div>
                      ))}
                      {(h.errors ?? []).map((e, j) => (
                        <div key={j} className="flex justify-between gap-2 text-red-500"><span className="font-mono" dir="ltr">{e.kind}</span><span className="truncate" dir="ltr">{e.error}</span></div>
                      ))}
                      <div className="flex justify-between"><span>{labels.down ?? ""}</span><span dir="ltr">{h.products} prod · {h.clients} cli · {h.images} img</span></div>
                      {h.error && <div className="text-red-500" dir="ltr">{h.error}</div>}
                      <div className="opacity-60" dir="ltr">{h.ms} ms</div>
                    </div>
                  )}
                </div>
              ))}
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => { void clearHistory().then(() => setHistory([])); }}
                  className="mx-auto block text-[11px] font-bold opacity-50 underline"
                >
                  {labels.clearHistory ?? "clear"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
