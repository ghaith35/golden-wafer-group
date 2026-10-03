"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { syncNow, getDeviceToken, clearDeviceConfig, type SyncPhase } from "@/lib/sync/client";
import { DeviceSetup } from "@/components/sync/DeviceSetup";
import { UpdateChecker } from "@/components/sync/UpdateChecker";
import { loadHistory, clearHistory, type SyncHistoryEntry } from "@/lib/sync/history";
import { cn } from "@/lib/utils";

type StepState = { label: string; state: "idle" | "active" | "done" | "error"; detail: string };

/// Sync popup: both directions with a progress bar —
/// 📤 phone → logiciel (outbox ops) then 📥 logiciel → phone (snapshot + images).
export function SyncModal({
  open,
  onClose,
  onDone,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
  labels: Record<string, string>;
}) {
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [result, setResult] = useState<{ applied: number; failed: number; remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// No device token (fresh phone) → setup mode first, then first sync.
  const [hasToken, setHasToken] = useState(false);
  /// Past syncs (what each one did, exactly).
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  const [showHist, setShowHist] = useState(false);
  const [openHist, setOpenHist] = useState<number | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    if (open) {
      setPct(0);
      setSteps([]);
      setResult(null);
      setError(null);
      setRunning(false);
      setShowHist(false);
      setOpenHist(null);
      try {
        setHasToken(!!getDeviceToken());
      } catch {
        setHasToken(false);
      }
      loadHistory().then(setHistory).catch(() => {});
    }
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
    setSteps([]);
    setPct(2);
    const alive = () => runId.current === id;
    try {
      await syncNow((p: SyncPhase) => {
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
          setPct(70 + Math.round(28 * (p.total ? p.done / Math.max(1, p.total) : 1)));
        } else if (p.phase === "done") {
          setSteps((ss) => ss.map((s) => ({ ...s, state: "done" as const })));
          setPct(100);
          setResult({ applied: p.applied, failed: p.failed, remaining: p.remaining });
          onDone?.();
        }
      });
    } catch (e) {
      if (!alive()) return;
      setError(e instanceof Error ? e.message : "sync_failed");
      setSteps((ss) => ss.map((s) => (s.state === "active" ? { ...s, state: "error" as const } : s)));
    } finally {
      if (alive()) {
        setRunning(false);
        loadHistory().then(setHistory).catch(() => {});
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={labels.title ?? "sync"} icon={<ArrowDownUp size={18} />} width="sm">
      {!hasToken ? (
        <DeviceSetup
          onConfigured={() => setHasToken(true)}
          labels={{
            setupHint: labels.setupHint, scanSetup: labels.scanSetup, manual: labels.manual,
            gallery: labels.gallery, qrNotFound: labels.qrNotFound, invalidQr: labels.invalidQr,
            tokenPh: labels.tokenPh, urlPh: labels.urlPh, tokenRequired: labels.tokenRequired,
            saveConfig: labels.saveConfig,
            camNeedHttps: labels.camNeedHttps, camDenied: labels.camDenied, camUnsupported: labels.camUnsupported,
            directSync: labels.directSync, noVan: labels.noVan,
          }}
        />
      ) : (
      <div className="space-y-3">
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
        {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1" disabled={running}>
            {labels.close ?? "close"}
          </Button>
          <Button onClick={() => void start()} disabled={running} className="flex-[2]">
            {running ? `${pct}%` : (labels.start ?? "sync")}
          </Button>
        </div>
        <button
          type="button"
          onClick={() => { clearDeviceConfig(); setHasToken(false); setSteps([]); setResult(null); setPct(0); }}
          className="mx-auto block text-[11px] font-bold opacity-50 underline"
        >
          {labels.resetConfig ?? "reset"}
        </button>
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
                        {new Date(h.ts).toLocaleDateString(undefined, { day: "numeric", month: "short" })}{" "}
                        {new Date(h.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
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
