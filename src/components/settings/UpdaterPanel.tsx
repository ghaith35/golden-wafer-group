"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, HardDriveDownload, Loader2, RefreshCw, Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/// Single update panel (Khiata layout): one CHECK pulls the latest version,
/// then the matching action applies it. Two tracks share the panel:
///   web bundle (seconds, no reinstall — the normal case), and
///   full installer (shell-level changes only, rare).
/// Desktop-only: renders a fallback note when the main-process bridge is
/// absent. Actions need settings-edit (Admin); viewing is open to all staff.

/// Feed/bundle errors are technical (raw URLs, http codes) — never show them
/// raw. Unpublished channel → feedMissing; anything else feed-related →
/// genericError. Only genuinely unknown messages pass through, URL-free.
function friendlyFeedError(err: unknown, labels: Record<string, string>): string {
  const s = String(err ?? "");
  if (!s || s === "failed") return labels.genericError ?? "failed";
  const noUrl = s.split("https://")[0].split("http://")[0].trim();
  if (s.includes("feed_http_404") || s === "feed_missing") return labels.feedMissing;
  if (/feed_|bundle_|bad_manifest|bad_bundle|bad_version|hash_mismatch|extract_failed|activate_failed/.test(s)) {
    return labels.genericError ?? noUrl ?? "failed";
  }
  return noUrl || s;
}

type WebPhase =
  | "idle" | "checking" | "up-to-date" | "available"
  | "downloading" | "ready" | "applying" | "applied" | "error";

type InstPhase = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";

export function UpdaterPanel({ labels }: { labels: Record<string, string> }) {
  const isDesktop = typeof window !== "undefined" && !!window.distribuili?.isDesktop;
  const [shell, setShell] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [feed, setFeed] = useState<string | null>(null);
  const [canAct, setCanAct] = useState(false);

  // Web track
  const [phase, setPhase] = useState<WebPhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState(false);

  // Installer track
  const [iphase, setIphase] = useState<InstPhase>("idle");
  const [iversion, setIversion] = useState<string | null>(null);
  const [inotes, setInotes] = useState<string | null>(null);
  const [iprogress, setIprogress] = useState<number | null>(null);
  const [imsg, setImsg] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => {
    if (!isDesktop) return;
    const offB = window.distribuili!.onBundleProgress((pct) => setProgress(pct));
    const offI = window.distribuili!.onUpdateProgress((pct) => setIprogress(pct));
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCanAct(d?.user?.role === "Admin"))
      .catch(() => setCanAct(false));
    window.distribuili!.bundleStatus()
      .then((r) => {
        const s = r as {
          ok?: boolean; shellVersion?: string; runningVersion?: string | null; feed?: string;
        } | undefined;
        if (s?.ok) {
          setShell(s.shellVersion ?? null);
          setRunning(s.runningVersion ?? null);
          setFeed(s.feed ?? null);
        }
      })
      .catch(() => {});
    return () => {
      offB();
      offI();
      stopPoll();
    };
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop) return;
    if (phase === "downloading" || phase === "applying") {
      stopPoll();
      pollRef.current = setInterval(() => {
        window.distribuili!.bundleStatus().catch(() => {});
      }, 1000);
    } else {
      stopPoll();
    }
    return stopPoll;
  }, [phase, isDesktop]);

  if (!isDesktop) {
    return (
      <Card>
        <p className="text-sm font-bold opacity-60">{labels.desktopOnly}</p>
      </Card>
    );
  }

  const busy = phase === "checking" || phase === "downloading" || phase === "applying" || iphase === "checking" || iphase === "downloading";

  const statusText =
    phase === "error" ? msg
    : phase === "available" ? labels.webAvailable
    : phase === "ready" ? labels.webReady
    : phase === "downloading" ? labels.download
    : phase === "applying" ? labels.webApplying
    : phase === "applied" ? labels.webApplied
    : running
      ? (labels.statusInstalled ?? "").replace("{v}", running)
      : shell
        ? (labels.statusInstalled ?? "").replace("{v}", shell)
        : labels.uptodate;

  async function check() {
    setPhase("checking");
    setIphase("checking");
    setMsg(null);
    setMsgErr(false);
    setImsg(null);
    setVersion(null);
    setIversion(null);
    setInotes(null);
    setProgress(null);
    setIprogress(null);
    // Web track
    try {
      const r = (await window.distribuili!.bundleCheck()) as {
        ok: boolean; currentVersion?: string; runningVersion?: string | null;
        version?: string | null; newer?: boolean; downloaded?: boolean; error?: string;
      };
      if (r.currentVersion) setShell(r.currentVersion);
      if (r.runningVersion !== undefined) setRunning(r.runningVersion);
      if (!r.ok) {
        setPhase("error");
        setMsg(friendlyFeedError(r.error, labels));
        setMsgErr(true);
      } else if (r.newer && r.version) {
        setVersion(r.version);
        setPhase(r.downloaded ? "ready" : "available");
        setMsg(r.downloaded ? labels.webReady : labels.webAvailable);
      } else {
        setPhase("up-to-date");
      }
    } catch (e) {
      setPhase("error");
      setMsg(friendlyFeedError(e, labels));
      setMsgErr(true);
    }
    // Installer track (informational — shell changes only)
    try {
      const r = (await window.distribuili!.updateCheck()) as {
        ok: boolean; currentVersion?: string; version?: string | null; releaseNotes?: string | null; error?: string;
      };
      if (r.currentVersion) setShell(r.currentVersion);
      if (r.ok && r.version) {
        setIversion(r.version);
        setInotes(r.releaseNotes ?? null);
        setIphase("available");
      } else if (r.ok) {
        setIphase("idle");
      } else {
        setIphase("error");
        setImsg(friendlyFeedError(r.error, labels));
      }
    } catch (e) {
      setIphase("error");
      setImsg(friendlyFeedError(e, labels));
    }
  }

  async function downloadWeb() {
    if (!version) return;
    setPhase("downloading");
    setProgress(0);
    try {
      const r = (await window.distribuili!.bundleDownload()) as { ok: boolean; error?: string };
      if (r.ok) {
        setPhase("ready");
        setProgress(100);
        setMsg(labels.webReady);
        setMsgErr(false);
      } else {
        setPhase("error");
        setMsg(friendlyFeedError(r.error, labels));
        setMsgErr(true);
      }
    } catch (e) {
      setPhase("error");
      setMsg(friendlyFeedError(e, labels));
      setMsgErr(true);
    }
  }

  async function applyWeb() {
    if (!version) return;
    setPhase("applying");
    setMsg(labels.webApplying);
    setMsgErr(false);
    try {
      const r = (await window.distribuili!.bundleApply()) as { ok: boolean; noop?: boolean; error?: string };
      if (r.ok) {
        setPhase("applied");
        setRunning(version);
        setMsg(labels.webApplied);
      } else {
        setPhase("error");
        setMsg(friendlyFeedError(r.error, labels));
        setMsgErr(true);
      }
    } catch (e) {
      setPhase("error");
      setMsg(friendlyFeedError(e, labels));
      setMsgErr(true);
    }
  }

  async function downloadInstaller() {
    setIphase("downloading");
    setIprogress(0);
    try {
      const r = (await window.distribuili!.updateDownload()) as { ok: boolean; error?: string };
      if (r.ok) {
        setIphase("downloaded");
        setIprogress(100);
      } else {
        setIphase("error");
        setImsg(friendlyFeedError(r.error, labels));
      }
    } catch (e) {
      setIphase("error");
      setImsg(friendlyFeedError(e, labels));
    }
  }

  return (
    <Card>
      {/* Version block */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase opacity-60">{labels.appVersion}</div>
          <div className="mt-0.5 font-mono text-2xl font-black tabular-nums" dir="ltr">{shell ?? "…"}</div>
          <p className="mt-1 text-[11px] opacity-60">
            {labels.runningBundle}: <bdi dir="ltr" className="font-mono font-black">{running ?? shell ?? "…"}</bdi>
            {feed ? ` · ${labels.channel}: ${feed}` : ""}
          </p>
        </div>
        {(phase === "ready" || phase === "applied") && (
          <span className="flex shrink-0 items-center gap-1 rounded-full pill-emerald px-2.5 py-1 text-xs font-black">
            <Check size={13} /> ✓
          </span>
        )}
      </div>

      {/* Status */}
      <div className="mt-3 rounded-xl bg-(--bg-sunken) p-2.5">
        <div className="text-[11px] font-bold uppercase opacity-60">{labels.status}</div>
        <p className={cn("mt-0.5 text-sm font-black", msgErr && "text-red-500")}>{statusText}</p>
      </div>

      {/* Check */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void check()} disabled={busy || !canAct} className="min-h-11 flex-1" title={!canAct ? labels.adminOnly : undefined}>
          {phase === "checking" || iphase === "checking" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {labels.checkUpdate}
        </Button>
        {(phase === "available" || (phase === "error" && version)) && (
          <Button onClick={() => void downloadWeb()} disabled={busy || !canAct} className="min-h-11 flex-1">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {labels.download}
          </Button>
        )}
        {phase === "ready" && (
          <Button onClick={() => void applyWeb()} disabled={busy || !canAct} className="min-h-11 flex-1">
            <Rocket size={15} />
            {labels.webApply}
          </Button>
        )}
      </div>

      {/* Notes */}
      {(version || inotes) && (
        <div className="mt-3">
          <div className="text-[11px] font-bold uppercase opacity-60">{labels.notes}</div>
          <div className="mt-1 max-h-32 overflow-y-auto rounded-xl bg-(--bg-sunken) p-2.5 text-xs whitespace-pre-wrap opacity-80" dir="auto">
            {version ? `web ${version}` : ""}{version && inotes ? "\n" : ""}{inotes ? String(inotes).replace(/<[^>]*>/g, "") : ""}
          </div>
        </div>
      )}

      {progress != null && phase === "downloading" && (
        <div className="mt-3">
          <div className="h-2.5 overflow-hidden rounded-full bg-(--bg-sunken)">
            <div className="h-2.5 rounded-full bg-(--brand-500)" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-right font-mono text-[11px] tabular-nums opacity-60" dir="ltr">{progress}%</p>
        </div>
      )}

      {/* Full installer (shell-level only, rare) */}
      {(iversion || iphase === "error") && (
        <div className="mt-4 border-t border-(--border-default) pt-3">
          <div className="text-[11px] font-bold uppercase opacity-60">{labels.fullInstaller}</div>
          {iversion && (
            <p className="mt-1 font-mono text-sm font-black tabular-nums" dir="ltr">→ {iversion}</p>
          )}
          {imsg && <p className="mt-1 text-xs font-bold text-red-500">{imsg}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {iphase === "available" && (
              <Button variant="secondary" onClick={() => void downloadInstaller()} disabled={busy || !canAct} className="min-h-11">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {labels.download}
              </Button>
            )}
            {iprogress != null && iphase === "downloading" && (
              <p className="self-center font-mono text-[11px] tabular-nums opacity-60" dir="ltr">{iprogress}%</p>
            )}
            {iphase === "downloaded" && (
              <Button onClick={() => window.distribuili!.updateInstall()} className="min-h-11">
                <HardDriveDownload size={15} />
                {labels.install}
              </Button>
            )}
          </div>
        </div>
      )}

      {!canAct && (
        <p className="mt-3 rounded-xl bg-(--bg-sunken) p-2.5 text-xs font-bold opacity-70">{labels.adminOnly}</p>
      )}

      {/* What happens on install */}
      <div className="mt-4 border-t border-(--border-default) pt-3">
        <div className="text-[11px] font-bold uppercase opacity-60">{labels.howTitle}</div>
        <ul className="mt-1 space-y-1 text-xs font-semibold leading-5 opacity-80">
          <li>• {labels.how1}</li>
          <li>• {labels.how2}</li>
          <li>• {labels.how3}</li>
        </ul>
      </div>
    </Card>
  );
}
