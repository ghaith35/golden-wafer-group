"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/// Settings → Updates (desktop only): Check → Download → Install & Restart.
export function UpdateManager({ labels }: { labels: Record<string, string> }) {
  const isDesktop = typeof window !== "undefined" && !!window.distribuili?.isDesktop;
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    const off = window.distribuili!.onUpdateProgress((pct) => setProgress(pct));
    return off;
  }, [isDesktop]);

  if (!isDesktop) return null;

  async function check() {
    setBusy(true);
    setMsg(null);
    setVersion(null);
    try {
      const r = (await window.distribuili!.updateCheck()) as { ok: boolean; version?: string; error?: string };
      if (r.ok && r.version) {
        setVersion(r.version);
        setMsg(labels.available);
      } else if (r.ok) {
        setMsg(labels.uptodate);
      } else {
        setMsg(r.error ?? "failed");
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
      } else {
        setMsg(r.error ?? "failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-sm font-bold">{labels.title}</h2>
      {msg && <p className="mb-2 text-sm opacity-70">{msg}</p>}
      {version && <p className="mb-2 font-mono text-sm">→ {version}</p>}
      {progress != null && !downloaded && (
        <div className="mb-2 h-2 rounded bg-(--bg-sunken)">
          <div className="h-2 rounded bg-(--brand-500)" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={check} disabled={busy}>{labels.check}</Button>
        {version && !downloaded && (
          <Button onClick={download} disabled={busy}>{labels.download}</Button>
        )}
        {downloaded && (
          <Button onClick={() => window.distribuili!.updateInstall()}>{labels.install}</Button>
        )}
      </div>
    </Card>
  );
}
