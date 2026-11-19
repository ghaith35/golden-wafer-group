"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { pendingCount } from "@/lib/sync/client";
import { applyWebUpdate, rememberBuild, storedBuild } from "@/lib/sync/web-update";

/// Fully automatic updater, mounted once globally:
/// - Web UI: if the logiciel has a newer build AND the outbox is empty
///   (nothing unsynced to lose), it refreshes into it silently.
/// - Native APK: silent install is impossible on stock Android, so a new
///   shell shows a persistent banner → one tap downloads, one tap installs
///   (same package/signature: data + outbox survive).
export function AutoUpdate() {
  const t = useTranslations("sync");
  const [apk, setApk] = useState<{ versionName: string; size: number; url: string } | null>(null);

  useEffect(() => {
    if (window.distribuili?.isDesktop) return;
    let dead = false;
    (async () => {
      try {
        const res = await fetch("/api/apk-info", { cache: "no-store" });
        if (!res.ok || dead) return;
        const d = await res.json().catch(() => null);
        if (!d || dead) return;
        // 1. Silent web update when safe.
        const server: string = d.web?.buildId || "";
        if (server) {
          const known = storedBuild();
          if (!known) {
            rememberBuild(server);
          } else if (known !== server) {
            const pending = await pendingCount().catch(() => 1);
            if (pending === 0 && !dead) {
              await applyWebUpdate(server).catch(() => {});
              return;
            }
          }
        }
        // 2. Native shell: banner when outdated (native only).
        let mine: number | null = null;
        try {
          const info = await App.getInfo();
          const n = Number(info.build);
          mine = Number.isFinite(n) && n > 0 ? n : null;
        } catch {
          mine = null;
        }
        if (!dead && mine != null && d.apk && Number(d.apk.versionCode) > mine) {
          setApk({ versionName: String(d.apk.versionName ?? ""), size: Number(d.apk.size ?? 0), url: String(d.apk.url) });
        }
      } catch {
        /* offline or server down — try again next launch */
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  if (!apk) return null;
  const size = apk.size > 1048576 ? `${(apk.size / 1048576).toFixed(1)} MB` : `${Math.round(apk.size / 1024)} KB`;
  return (
    <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 lg:bottom-6 lg:start-auto lg:end-6 lg:max-w-sm">
      <div className="flex items-center gap-2.5 rounded-2xl border border-(--brand-500) bg-(--bg-overlay) p-3 shadow-2xl">
        <span className="text-xl">⬆️</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black">
            {t("apkNew")} {apk.versionName} ({size})
          </div>
          <div className="truncate text-[11px] opacity-60">{t("apkHint")}</div>
        </div>
        <button
          type="button"
          onClick={() =>
            Browser.open({ url: new URL(apk.url, window.location.origin).toString() }).catch(() =>
              window.open(apk.url, "_blank")
            )
          }
          className="h-10 shrink-0 rounded-xl bg-(--brand-500) px-4 text-sm font-black text-(--brand-contrast)"
        >
          {t("downloadApk")}
        </button>
      </div>
    </div>
  );
}
