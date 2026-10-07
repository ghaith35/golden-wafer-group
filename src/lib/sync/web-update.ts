"use client";

/// Web OTA primitives shared by the sync-time prompt (SyncModal), the manual
/// checker (UpdateChecker) and the silent launch updater (AutoUpdate).
/// Web content = cache clear + reload ("restart, update, reopen"). The outbox
/// and snapshot live in durable storage, so reloading never loses data.
/// Native shell changes still need an APK reinstall (Android rule).

export const WEB_BUILD_KEY = "dili_web_build";

export function storedBuild(): string | null {
  try {
    return localStorage.getItem(WEB_BUILD_KEY);
  } catch {
    return null;
  }
}

export function rememberBuild(buildId: string): void {
  try {
    localStorage.setItem(WEB_BUILD_KEY, buildId);
  } catch {
    /* ignore */
  }
}

/// Pure decision: prompt only when the server moved AND we knew a build.
/// First sighting just records (no prompt on first install).
export function shouldPromptWebUpdate(known: string | null, server: string): boolean {
  return !!server && !!known && known !== server;
}

/// Apply a validated web update: forget every cached shell + data page
/// (product photos cache `dili-img-*` is kept), record the build, reopen.
export async function applyWebUpdate(buildId: string): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.includes("dili-img")).map((k) => caches.delete(k)));
    }
    if (buildId) rememberBuild(buildId);
  } finally {
    window.location.reload();
  }
}
