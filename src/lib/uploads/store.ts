/// Runtime upload storage: files must survive web-bundle swaps (and are shared
/// by every bundle version), so they live OUTSIDE the bundle in the persistent
/// app-data dir — never in <bundle>/public (each apply wipes that view and
/// every previously uploaded image 404s, i.e. the broken-image icon).
/// Served by src/app/uploads/[...path]/route.ts under the SAME /uploads/*
/// URL shape, so stored URLs keep working unchanged.

import { join, basename, sep } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

export const UPLOAD_SUBS = ["products", "vans", "invoices"] as const;

/// Writable persistent root. Desktop shell sets DISTRIBUILI_USERDATA;
/// anywhere else (dev / docker) fall back to the legacy public/ tree.
export function uploadsRoot(): string {
  const ud = (process.env.DISTRIBUILI_USERDATA ?? "").trim();
  if (ud) return join(ud, "uploads");
  return join(process.cwd(), "public", "uploads");
}

/// Strict filename check (we mint hex names; rejects traversal outright).
export function isSafeUploadName(name: string): boolean {
  return /^[a-f0-9]{16,64}\.(jpg|jpeg|png|webp)$/i.test(name);
}

/// Legacy spots an image may still live in (pre-fix uploads):
///  1. the baked installer tree (reachable in the Electron shell via
///     process.resourcesPath — plain node has none, guarded),
///  2. any downloaded web-bundle's public/ dir,
///  3. the current bundle's own public/ dir.
/// Returns the first hit, if any.
export function findLegacyUpload(sub: string, name: string): string | null {
  const safe = basename(name);
  if (safe !== name || !isSafeUploadName(safe)) return null;
  const candidates: string[] = [];
  try {
    const rp = (process as unknown as { resourcesPath?: string }).resourcesPath;
    if (rp) candidates.push(join(rp, "app", ".next", "standalone", "public", "uploads", sub, safe));
  } catch {
    /* plain node — no resourcesPath */
  }
  const ud = (process.env.DISTRIBUILI_USERDATA ?? "").trim();
  if (ud) {
    try {
      const bundles = join(ud, "web-bundles");
      for (const e of readdirSync(bundles)) {
        if (/^\d+\.\d+\.\d+$/.test(e)) {
          candidates.push(join(bundles, e, "public", "uploads", sub, safe));
        }
      }
    } catch {
      /* no bundles dir yet */
    }
  }
  candidates.push(join(process.cwd(), "public", "uploads", sub, safe));
  for (const p of candidates) {
    try {
      if (p.split(sep).includes("..")) continue;
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}
