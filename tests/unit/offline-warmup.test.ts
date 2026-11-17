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
    expect(urls).toContain("/ar/livreur/2026-10-13/commandes?ready=1");
    expect(urls).not.toContain("/ar/livreur");
    const seller = warmManifest("ar", "2026-10-13", "Vendeur");
    expect(seller).toContain("/ar/livreur/2026-10-13/commande");
    expect(seller.some((url) => /\/(vente|factures|demande)$|\?ready=1/.test(url))).toBe(false);
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

describe("offline page assets", () => {
  it("requires the route script and stylesheet before a page is ready", async () => {
    const { warmAndVerify, WARM_SW_VERSION } = await import("@/lib/sync/client");
    const origin = "https://shop.example";
    const page = "/ar/livreur/2026-10-13/stock";
    const script = "/_next/static/stock.js";
    const style = "/_next/static/stock.css";
    const stored = new Map<string, Set<string>>();
    let scriptAvailable = false;

    vi.stubGlobal("window", { location: { origin } });
    vi.stubGlobal("navigator", { onLine: true, serviceWorker: { controller: {} } });
    vi.stubGlobal("caches", {
      async open(name: string) {
        const keys = stored.get(name) ?? new Set<string>();
        stored.set(name, keys);
        return {
          async match(url: string) { return keys.has(url) ? new Response() : undefined; },
          async put(url: string) { keys.add(url); },
        };
      },
    });
    vi.stubGlobal("DOMParser", class {
      parseFromString() {
        return {
          querySelectorAll: () => [
            { getAttribute: (name: string) => name === "src" ? script : null },
            { getAttribute: (name: string) => name === "href" ? style : null },
          ],
        };
      }
    });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === origin + script && !scriptAvailable) return new Response(null, { status: 404 });
      const contentType = url.endsWith(".js") ? "application/javascript" : url.endsWith(".css") ? "text/css" : "text/html";
      const response = new Response("saved", { headers: { "content-type": contentType } });
      Object.defineProperty(response, "url", { value: url });
      return response;
    });

    try {
      expect(await warmAndVerify([page])).toEqual([{ url: page, ok: false }]);
      expect(stored.get(`${WARM_SW_VERSION}-pages`)?.has(origin + page)).toBe(false);
      scriptAvailable = true;
      expect(await warmAndVerify([page])).toEqual([{ url: page, ok: true }]);
      expect(stored.get(`${WARM_SW_VERSION}-static`)).toEqual(new Set([origin + script, origin + style]));
      expect(stored.get(`${WARM_SW_VERSION}-pages`)?.has(origin + page)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
