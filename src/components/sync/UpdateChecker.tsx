"use client";

import { useState } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Button } from "@/components/ui/Button";
import { applyWebUpdate, rememberBuild, storedBuild, WEB_BUILD_KEY } from "@/lib/sync/web-update";
export { WEB_BUILD_KEY };

type Feed = {
  web: { buildId: string };
  apk: { versionCode: number; versionName: string; size: number; builtAt: string; url: string } | null;
};

async function installedCode(): Promise<number | null> {
  try {
    const info = await App.getInfo();
    const n = Number(info.build);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null; // browser: no APK to compare
  }
}

/// Phone updater: web UI refresh (no reinstall) + APK download when the
/// native shell itself changed. Fed by /api/apk-info (public).
export function UpdateChecker({ labels }: { labels: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [webState, setWebState] = useState<"unknown" | "fresh" | "new" | "updated">("unknown");
  const [mine, setMine] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/apk-info", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const d = (await res.json()) as Feed;
      setFeed(d);
      try {
        setMine(await installedCode());
      } catch {
        setMine(null);
      }
      const server = d.web.buildId || "";
      const known = storedBuild();
      if (!server) {
        setWebState("fresh");
      } else if (!known) {
        rememberBuild(server);
        setWebState("fresh");
      } else if (known !== server) {
        setWebState("new");
      } else {
        setWebState("fresh");
      }
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateWeb() {
    await applyWebUpdate(feed?.web.buildId ?? "");
  }

  async function downloadApk() {
    if (!feed?.apk) return;
    try {
      await Browser.open({ url: new URL(feed.apk.url, window.location.origin).toString() });
    } catch {
      window.open(feed.apk.url, "_blank");
    }
  }

  const apkNew = feed?.apk != null && mine != null && feed.apk.versionCode > mine;
  const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

  return (
    <div className="border-t border-(--border-subtle) pt-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-black">⬆️ {labels.updateTitle ?? "update"}</span>
        <Button variant="secondary" onClick={() => void check()} disabled={busy} className="h-9 px-3 text-xs">
          {labels.checkUpdate ?? "check"}
        </Button>
      </div>
      {error && <p className="mb-2 rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500">{error}</p>}
      {webState === "fresh" && feed && (
        <p className="mb-1 text-[11px] font-bold text-emerald-600">✓ {labels.webOk ?? ""}</p>
      )}
      {webState === "new" && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-(--brand-500)/10 px-2.5 py-2">
          <span className="text-[11px] font-black text-(--brand-600)">{labels.webNew ?? ""}</span>
          <Button onClick={() => void updateWeb()} className="h-9 shrink-0 px-3 text-xs">
            {labels.updateNow ?? ""}
          </Button>
        </div>
      )}
      {feed?.apk && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-(--bg-sunken) px-2.5 py-2">
          <span className="text-[11px] font-bold opacity-70" dir="ltr">
            APK {feed.apk.versionName} ({feed.apk.size ? fmtSize(feed.apk.size) : ""})
            {mine != null ? ` · mine: ${mine}` : ""}
          </span>
          {apkNew ? (
            <Button onClick={() => void downloadApk()} className="h-9 shrink-0 px-3 text-xs">
              {labels.download ?? ""}
            </Button>
          ) : (
            <span className="text-[11px] font-black text-emerald-600">✓</span>
          )}
        </div>
      )}
      {apkNew && <p className="mt-1 text-[11px] opacity-60">{labels.apkHint ?? ""}</p>}
    </div>
  );
}
