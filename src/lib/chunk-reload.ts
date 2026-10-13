"use client";

/// Chunk-load safety net (stale-deploy ChunkLoadError): after a shop-PC EXE
/// update, a phone holding cached HTML from the previous build can ask for
/// hashed chunks the server no longer keeps → "failed to load chunk" and a
/// dead button instead of the sale flow. The service worker already drops
/// the page cache on a chunk 404 (self-heal on the NEXT load) — this closes
/// the loop with ONE guarded reload so the current load heals too:
///   online  → reload once (fresh HTML references live chunks);
///   offline → reload once as well (the worker answers from the consistent
///             cached set; a chunk missing from cache stays missing, but a
///             half-hydrated tree is never better than a clean cached one).
/// The guard (sessionStorage) allows exactly one auto-reload per tab: a
/// second chunk failure in the same session surfaces normally instead of
/// looping forever. Never throws, never blocks, no-ops on the server.

const GUARD_KEY = "dili_chunk_reload_v1";

/// True for bundler chunk-load failures (webpack/vite/next divorce the
/// module graph with these signatures).
export function isChunkLoadError(message: unknown): boolean {
  const s = String(message ?? "");
  return (
    s.includes("ChunkLoadError") ||
    s.includes("Loading chunk") ||
    s.includes("Failed to fetch dynamically imported module") ||
    s.includes("Importing a module script failed") ||
    s.includes("error loading dynamically imported module")
  );
}

function guardSpent(): boolean {
  try {
    return sessionStorage.getItem(GUARD_KEY) === "1";
  } catch {
    return true; // private mode: never auto-reload blind
  }
}

function spendGuard(): void {
  try {
    sessionStorage.setItem(GUARD_KEY, "1");
  } catch { /* ignore */ }
}

function reloadOnce(): void {
  if (guardSpent()) return;
  spendGuard();
  try {
    window.location.reload();
  } catch { /* ignore */ }
}

/// Mount once (app shell): watches unhandled rejections + resource errors
/// for chunk-load signatures. Returns the detach function.
export function watchChunkErrors(): () => void {
  try {
    if (typeof window === "undefined") return () => {};
    const onRejection = (e: PromiseRejectionEvent) => {
      try {
        const msg = (e.reason as Error)?.message ?? (e.reason as { message?: unknown })?.message ?? e.reason;
        if (isChunkLoadError(msg)) {
          try {
            e.preventDefault?.();
          } catch { /* ignore */ }
          reloadOnce();
        }
      } catch { /* never break the page */ }
    };
    const onError = (e: ErrorEvent) => {
      try {
        if (isChunkLoadError(e.message)) reloadOnce();
      } catch { /* never break the page */ }
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      try {
        window.removeEventListener("unhandledrejection", onRejection);
        window.removeEventListener("error", onError);
      } catch { /* ignore */ }
    };
  } catch {
    return () => {};
  }
}
