// Provider-agnostic auto-update service (electron-updater, Jafraa pattern).
// MANUAL wizard flow: autoDownload=false, install only on explicit user click
// from Settings → Updates (Check → Download → Install & Restart).
// Feed override priority: DISTRIBUILI_UPDATE_URL env → <userData>/update-feed.json
// → baked app-update.yml. latest.yml MUST be served with Cache-Control: no-cache.

import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type UpdateFeedOverride =
  | { kind: "generic"; url: string }
  | { kind: "github"; owner: string; repo: string };

export function readFeedOverride(userDataDir: string): UpdateFeedOverride | null {
  const envUrl = (process.env.DISTRIBUILI_UPDATE_URL || "").trim();
  if (envUrl) return { kind: "generic", url: envUrl };
  try {
    const f = join(userDataDir, "update-feed.json");
    if (!existsSync(f)) return null;
    const raw = JSON.parse(readFileSync(f, "utf8")) as {
      url?: string;
      github?: { owner?: string; repo?: string };
    };
    if (raw.url) return { kind: "generic", url: String(raw.url) };
    if (raw.github?.owner && raw.github?.repo) {
      return { kind: "github", owner: raw.github.owner, repo: raw.github.repo };
    }
  } catch {
    /* ignore malformed override — fall back to baked feed */
  }
  return null;
}

type Logger = (msg: string) => void;

export function configureUpdater(log: Logger, userDataDir: string): string {
  if (!app.isPackaged) return "dev — updater disabled";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    try {
      (autoUpdater as unknown as { autoInstallEvent?: string }).autoInstallEvent = "manual";
    } catch {
      /* older electron-updater — flags above already cover it */
    }
    autoUpdater.logger = {
      info: (m: unknown) => log(`[updater] ${String(m)}`),
      warn: (m: unknown) => log(`[updater:warn] ${String(m)}`),
      error: (m: unknown) => log(`[updater:error] ${String(m)}`),
      debug: (m: unknown) => log(`[updater:debug] ${String(m)}`),
    } as unknown as import("electron-updater").Logger;

    const override = readFeedOverride(userDataDir);
    if (override) {
      if (override.kind === "generic") {
        autoUpdater.setFeedURL({ provider: "generic", url: override.url, channel: "latest" });
        return `override generic → ${override.url}`;
      }
      autoUpdater.setFeedURL({ provider: "github", owner: override.owner, repo: override.repo });
      return `override github → ${override.owner}/${override.repo}`;
    }
    return "baked app-update.yml";
  } catch (e) {
    log(`[updater] configure failed: ${e}`);
    return `configure-failed: ${e}`;
  }
}
