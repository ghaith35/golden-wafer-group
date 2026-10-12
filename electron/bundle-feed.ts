// Pure helpers for the desktop web-bundle feed (no electron imports, so
// vitest can cover this module). The feed manifest is:
//   { version: "1.2.3", bundle_url: "https://…/bundle-1.2.3.tar.gz",
//     sha256: "<64 hex>", builtAt: "2026-…" }
// Integrity is sha256-over-HTTPS (no signature verification yet).

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

export type BundleManifest = {
  version: string;
  bundle_url: string;
  sha256: string;
  builtAt: string;
};

const HEX64 = /^[0-9a-fA-F]{64}$/;

/// Bundle archives must come from https — except loopback URLs, which exist
/// so developers can trial the flow against `python3 -m http.server` without
/// standing up TLS. Packaged physics are unchanged: LAN/production http is
/// still rejected.
const LOOPBACK_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i;
function isAllowedBundleUrl(url: string): boolean {
  return /^https:\/\//i.test(url) || LOOPBACK_URL.test(url);
}
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/// Strict 3-part semver parse. Returns null for anything else
/// ("1.2", "v1.2.3", "1.2.3-beta" are all rejected).
export function parseSemver(v: string): [number, number, number] | null {
  const m = SEMVER.exec(String(v || "").trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/// -1 | 0 | 1. Throws on non-semver input (fail closed).
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`bad_version: ${a} vs ${b}`);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/// True only when candidate is strictly newer (downgrades never apply).
export function isNewerThan(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/// Validate an unknown manifest payload. Throws on any shape violation.
export function parseManifest(raw: unknown): BundleManifest {
  if (!raw || typeof raw !== "object") throw new Error("bad_manifest: not an object");
  const m = raw as Record<string, unknown>;
  const version = String(m.version ?? "");
  const bundle_url = String(m.bundle_url ?? "");
  const sha256 = String(m.sha256 ?? "");
  const builtAt = String(m.builtAt ?? "");
  if (!parseSemver(version)) throw new Error(`bad_manifest: version ${version}`);
  if (!isAllowedBundleUrl(bundle_url)) throw new Error("bad_manifest: bundle_url must be https (http only for localhost trials)");
  if (!HEX64.test(sha256)) throw new Error("bad_manifest: sha256 must be 64 hex chars");
  if (!builtAt) throw new Error("bad_manifest: builtAt missing");
  return { version, bundle_url, sha256, builtAt };
}

export async function fetchManifest(feedUrl: string, timeoutMs = 20000): Promise<BundleManifest> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(feedUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-store" },
    });
    // The feed must answer directly — a redirecting feed is a misconfiguration.
    if (res.status >= 300 && res.status < 400) throw new Error(`feed_redirect: ${feedUrl}`);
    if (!res.ok) throw new Error(`feed_http_${res.status}: ${feedUrl}`);
    return parseManifest(await res.json());
  } finally {
    clearTimeout(t);
  }
}

/// Case-insensitive hash compare (manifest may carry upper-case hex).
export function sameHash(a: string, b: string): boolean {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

export async function sha256File(path: string): Promise<string> {
  const fh = await open(path, "r");
  try {
    const hash = createHash("sha256");
    for await (const chunk of fh.createReadStream()) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await fh.close();
  }
}

export type ProgressCb = (downloadedBytes: number, totalBytes: number | null) => void;

/// Stream-download a URL to disk WITHOUT following redirects (the bundle URL
/// must be direct). Resolves with the total bytes written.
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: ProgressCb,
  timeoutMs = 600000
): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "manual", signal: ctrl.signal });
    if (res.status >= 300 && res.status < 400) throw new Error("bundle_redirect: tarball URL must be direct");
    if (!res.ok || !res.body) throw new Error(`bundle_http_${res.status}`);
    const total = res.headers.get("content-length");
    const totalBytes = total ? Number(total) : null;
    let done = 0;
    const counting = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        done += chunk.byteLength;
        onProgress?.(done, Number.isFinite(totalBytes) ? totalBytes : null);
        controller.enqueue(chunk);
      },
    });
    await pipeline(
      res.body.pipeThrough(counting) as unknown as NodeJS.ReadableStream,
      createWriteStream(destPath)
    );
    return done;
  } finally {
    clearTimeout(t);
  }
}
