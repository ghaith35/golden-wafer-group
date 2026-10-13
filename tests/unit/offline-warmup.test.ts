import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isChunkLoadError } from "@/lib/chunk-reload";

// The first-run warmup flag carries the SW cache generation: a worker
// upgrade purges every older cache, so a "done" from a previous generation
// must force a re-warm instead of trusting wiped caches (the v12 chunk
// failures). This test fails the build the moment the two drift apart.
describe("offline warmup generation lockstep", () => {
  it("WARM_SW_VERSION matches public/sw.js VERSION", async () => {
    const { WARM_SW_VERSION } = await import("@/lib/sync/client");
    const sw = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    const m = /const VERSION = "([^"]+)"/.exec(sw);
    expect(m?.[1]).toBeTruthy();
    expect(WARM_SW_VERSION).toBe(m?.[1]);
  });

  it("warmManifest covers the driver loop incl. the start screen", async () => {
    vi.stubGlobal("window", undefined as never);
    const { warmManifest } = await import("@/lib/sync/client");
    const urls = warmManifest("ar", "2026-10-13");
    expect(urls.length).toBeGreaterThan(10);
    expect(urls).toContain("/ar/livreur/2026-10-13/start");
    vi.unstubAllGlobals();
  });
});

describe("isChunkLoadError", () => {
  it("recognizes bundler chunk failures, ignores the rest", () => {
    expect(isChunkLoadError(new Error("ChunkLoadError: Loading chunk 472 failed"))).toBe(true);
    expect(isChunkLoadError("Loading chunk vendors failed")).toBe(true);
    expect(isChunkLoadError("Failed to fetch dynamically imported module: /_next/static/x.js")).toBe(true);
    expect(isChunkLoadError("Importing a module script failed.")).toBe(true);
    expect(isChunkLoadError(new Error("NetworkError when attempting to fetch resource."))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("sync_failed")).toBe(false);
  });
});
