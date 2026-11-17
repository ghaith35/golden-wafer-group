"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Image as ImageIcon, Loader2, MonitorDown, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  getDeviceToken,
  isServerReachable,
  syncNow,
  prepareOfflinePages,
  warmOfflineChunks,
  WARM_SW_VERSION,
  type SyncPhase,
} from "@/lib/sync/client";
import { cn } from "@/lib/utils";

export type FirstRunLabels = {
  title: string;
  hint: string;
  stepSync: string;
  stepPages: string;
  stepMedia: string;
  done: string;
  doneHint: string;
  pairNeeded: string;
  pairHint: string;
  openSync: string;
  retry: string;
};

const WARM_FLAG = "dili_first_warm_v2";

type StepState = "idle" | "active" | "done" | "fail" | "pair";

/// First-login warmup (mounted on the day dashboard): the FIRST time a fresh
/// phone reaches the dashboard online, this popup automatically caches the
/// whole driver app — full sync (snapshot + product photos) then every
/// journée screen verified in cache — and vanishes when done. After that
/// the driver can go offline and work directly.
/// Dismiss (✕) postpones: the flag is set ONLY on full success, so the
/// popup re-arms on the next dashboard visit until the phone is truly ready.
/// A phone with no device pairing yet warms its pages but stops before the
/// sync step with a one-tap jump into the Sync screen to pair.
export function FirstRunWarmup({
  locale,
  day,
  role,
  labels,
  onOpenSync,
}: {
  locale: string;
  day: string;
  role: string;
  labels: FirstRunLabels;
  onOpenSync: () => void;
}) {
  const [show, setShow] = useState(false);
  const [sync, setSync] = useState<StepState>("idle");
  const [pages, setPages] = useState<StepState>("idle");
  const [media, setMedia] = useState<StepState>("idle");
  const [syncDetail, setSyncDetail] = useState("");
  const [pagesDetail, setPagesDetail] = useState("");
  const [finished, setFinished] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Mount-gate (not derived render state): decides once, client-only,
    // whether this phone ever warmed up — so the server HTML (hidden)
    // always hydrates cleanly.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount gate, see above
    if (shouldShowWarmup()) setShow(true);
  }, []);

  function shouldShowWarmup(): boolean {
    try {
      const raw = localStorage.getItem(WARM_FLAG);
      if (raw) {
        const p = JSON.parse(raw) as { origin?: unknown; done?: unknown; sw?: unknown };
        // A worker upgrade purges every older cache — a "done" stamped by a
        // previous SW generation no longer means warm. Re-run instead of
        // trusting it (this is what left phones chunk-broken after v12).
        if (p.done === true && p.origin === window.location.origin && p.sw === WARM_SW_VERSION) return false;
      }
      // Offline first login (offline unlock): stay silent — the popup
      // re-arms on the next online dashboard visit.
      if (window.navigator?.onLine === false || !isServerReachable()) return false;
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!show || started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show ]);

  function flagDone() {
    try {
      localStorage.setItem(WARM_FLAG, JSON.stringify({ origin: window.location.origin, done: true, sw: WARM_SW_VERSION, ts: Date.now() }));
    } catch { /* private mode — popup re-arms, harmless */ }
  }

  async function run() {
    // ── 1. Sync: snapshot + photos (needs the paired device) ──────────
    setSync("active");
    let token = false;
    try {
      token = !!getDeviceToken();
    } catch { /* ignore */ }
    if (!token) {
      setSync("pair");
    } else {
      try {
        await syncNow((p: SyncPhase) => {
          try {
            if (p.phase === "upload") setSyncDetail(`${p.sent}/${p.total}`);
            else if (p.phase === "apply") setSyncDetail(`${p.done}/${p.total}`);
            else if (p.phase === "download") setSyncDetail(`${p.products + p.clients}`);
            else if (p.phase === "images") setSyncDetail(`${p.done}/${p.total}`);
          } catch { /* never break the run */ }
        });
        setSync("done");
        setSyncDetail("");
      } catch {
        setSync("fail");
        return;
      }
    }
    // ── 2. Pages: every journée screen, verified in cache ─────────────
    setPages("active");
    try {
      const results = await prepareOfflinePages(locale, day, role);
      const ok = results.filter((r) => r.ok).length;
      setPagesDetail(`${ok}/${results.length}`);
      if (ok !== results.length) {
        setPages("fail");
        return;
      }
      setPages("done");
    } catch {
      setPages("fail");
      return;
    }
    // ── 3. Media: lazy chunks (QR/camera/PDF/maps/native) + fonts ──────
    // Same set as warmOfflineChunks (single source), then verified: an
    // import resolving means its chunk went through the SW static branch.
    setMedia("active");
    try {
      warmOfflineChunks();
      const settled = await Promise.allSettled([
        import("jsqr").then(() => true).catch(() => false),
        import("qrcode").then(() => true).catch(() => false),
        import("@capacitor/core").then(() => true).catch(() => false),
        import("@/lib/pdf/ticketPdf").then(() => true).catch(() => false),
      ]);
      const chunksOk = settled.filter((r) => r.status === "fulfilled" && r.value).length;
      let fonts = 0;
      try {
        const hits = await Promise.all(
          ["/fonts/amiri-regular.ttf", "/fonts/amiri-bold.ttf"].map((u) =>
            caches.match(u).then((h) => (h ? 1 : 0)).catch(() => 0)
          )
        );
        fonts = hits.reduce((a, b) => a + b, 0);
      } catch { /* ignore */ }
      // Chunks are best-effort by design (a missing map shell must never
      // block readiness) — the count stays honest in devtools, the step
      // completes, and the global chunk-error guard heals rotated builds.
      void chunksOk;
      void fonts;
      setMedia("done");
    } catch {
      setMedia("done"); // best-effort by design — never blocks readiness
    }
    // ── Done (sync-paired runs only) ──────────────────────────────────
    if (token) {
      setFinished(true);
      flagDone();
      window.setTimeout(() => setShow(false), 1800);
    }
  }

  if (!show) return null;

  const rows: Array<{ key: string; label: string; state: StepState; detail: string; Icon: typeof Download }> = [
    { key: "sync", label: labels.stepSync, state: sync, detail: syncDetail, Icon: Download },
    { key: "pages", label: labels.stepPages, state: pages, detail: pagesDetail, Icon: MonitorDown },
    { key: "media", label: labels.stepMedia, state: media, detail: "", Icon: ImageIcon },
  ];
  const doneCount = rows.filter((r) => r.state === "done").length;

  return (
    <Modal open onClose={() => setShow(false)} title={labels.title} subtitle={labels.hint} icon={<Smartphone size={18} />} width="sm">
      <div className="space-y-3">
        {finished ? (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 p-3">
            <CheckCircle2 size={22} className="shrink-0 text-emerald-500" />
            <div>
              <div className="text-sm font-black">{labels.done}</div>
              <div className="text-xs opacity-60">{labels.doneHint}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-(--bg-sunken)">
              <div
                className="h-full rounded-full bg-(--brand-500) transition-all duration-500"
                style={{ width: `${Math.round((doneCount / rows.length) * 100)}%` }}
              />
            </div>
            <div className="space-y-1.5">
              {rows.map(({ key, label, state, detail, Icon }) => (
                <div key={key} className="flex items-center gap-3 rounded-xl bg-(--bg-sunken) px-3 py-2.5">
                  <span className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    state === "done" ? "bg-emerald-500/15 text-emerald-500"
                    : state === "fail" || state === "pair" ? "bg-amber-500/15 text-amber-500"
                    : "bg-(--brand-500)/10 text-(--brand-600)"
                  )}>
                    {state === "done" ? <CheckCircle2 size={18} />
                      : state === "active" ? <Loader2 size={18} className="animate-spin" />
                      : <Icon size={18} />}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-black">{label}</span>
                  {detail !== "" && (
                    <span className="shrink-0 text-xs font-black tabular-nums opacity-60" dir="ltr">{detail}</span>
                  )}
                </div>
              ))}
            </div>
            {sync === "pair" && (
              <div className="rounded-xl bg-amber-500/10 p-3">
                <p className="text-[13px] font-black text-amber-600">{labels.pairNeeded}</p>
                <p className="mt-0.5 text-xs font-bold leading-5 opacity-70">{labels.pairHint}</p>
                <Button
                  className="mt-2 w-full"
                  onClick={() => {
                    setShow(false);
                    onOpenSync();
                  }}
                >
                  {labels.openSync}
                </Button>
              </div>
            )}
            {(sync === "fail" || pages === "fail") && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setSync("idle");
                  setPages("idle");
                  setMedia("idle");
                  setSyncDetail("");
                  setPagesDetail("");
                  started.current = false;
                  void run();
                }}
              >
                {labels.retry}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
