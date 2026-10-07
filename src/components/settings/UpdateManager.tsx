"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, Check, Download, Loader2, RefreshCw, Rocket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type CheckResult = {
  ok: boolean;
  currentVersion?: string;
  version?: string | null;
  releaseNotes?: string | null;
  error?: string;
};

/// Settings → Updates (desktop only): Check → Download → Install & Restart.
/// Manual wizard (repaire pattern): nothing downloads/installs without an
/// explicit click. The feed lives at distribuili.khiatadz.com/updates.
export function UpdateManager({ labels }: { labels: Record<string, string> }) {
  const isDesktop = typeof window !== "undefined" && !!window.distribuili?.isDesktop;
  const [current, setCurrent] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<"info" | "ok" | "err">("info");

  useEffect(() => {
    if (!isDesktop) return;
    const off = window.distribuili!.onUpdateProgress((pct) => setProgress(pct));
    return off;
  }, [isDesktop]);

  if (!isDesktop) return null;

  async function check() {
    setBusy(true);
    setMsg(null);
    setTone("info");
    setVersion(null);
    setNotes(null);
    setDownloaded(false);
    setProgress(null);
    try {
      const r = (await window.distribuili!.updateCheck()) as CheckResult;
      if (r.currentVersion) setCurrent(r.currentVersion);
      if (r.ok && r.version) {
        setVersion(r.version);
        setNotes(r.releaseNotes ?? null);
        setMsg(labels.available);
        setTone("ok");
      } else if (r.ok) {
        setMsg(labels.uptodate);
        setTone("ok");
      } else {
        setMsg(r.error ?? "failed");
        setTone("err");
      }
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    try {
      const r = (await window.distribuili!.updateDownload()) as { ok: boolean; error?: string };
      if (r.ok) {
        setDownloaded(true);
        setMsg(labels.downloaded);
        setTone("ok");
      } else {
        setMsg(r.error ?? "failed");
        setTone("err");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)">
          <Rocket size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black">{labels.title}</h2>
          {current && (
            <p className="text-[11px] opacity-60" dir="ltr">
              {labels.current} {current}
            </p>
          )}
        </div>
        {version && !downloaded && (
          <span className="shrink-0 rounded-full bg-(--brand-500)/10 px-2.5 py-1 font-mono text-xs font-black text-(--brand-600)" dir="ltr">
            → {version}
          </span>
        )}
        {downloaded && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-600">
            <Check size={13} /> ✓
          </span>
        )}
      </div>

      {msg && (
        <p className={cn(
          "mt-3 rounded-xl p-2.5 text-sm font-bold",
          tone === "ok" && "bg-emerald-500/10 text-emerald-600",
          tone === "err" && "bg-red-500/10 text-red-500",
          tone === "info" && "bg-(--bg-sunken) opacity-80"
        )}>
          {msg}
        </p>
      )}

      {notes && (
        <div className="mt-2 max-h-32 overflow-y-auto rounded-xl bg-(--bg-sunken) p-2.5 text-xs whitespace-pre-wrap opacity-80" dir="auto">
          {notes.replace(/<[^>]*>/g, "")}
        </div>
      )}

      {progress != null && !downloaded && (
        <div className="mt-3">
          <div className="h-2.5 overflow-hidden rounded-full bg-(--bg-sunken)">
            <div className="h-2.5 rounded-full bg-(--brand-500) transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-right font-mono text-[11px] tabular-nums opacity-60" dir="ltr">{progress}%</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void check()} disabled={busy} className="min-h-11">
          {busy && !version ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {labels.check}
        </Button>
        {version && !downloaded && (
          <Button onClick={() => void download()} disabled={busy} className="min-h-11 flex-1">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {labels.download}
          </Button>
        )}
        {downloaded && (
          <Button onClick={() => window.distribuili!.updateInstall()} className="min-h-11 flex-1">
            <ArrowDownToLine size={15} />
            {labels.install}
          </Button>
        )}
      </div>
    </Card>
  );
}
