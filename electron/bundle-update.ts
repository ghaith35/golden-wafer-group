// Desktop web-bundle updater (main process): downloads a versioned Next.js
// standalone bundle (.tar.gz) from an HTTPS feed, sha256-verifies it,
// extracts it to a per-version directory under userData, and (via main.ts)
// restarts the local server on the new directory. No reinstall.
//
// Layout under <userData>/:
//   web-bundles/<version>/   extracted bundle (server.js + .next + …)
//   web-bundles/<version>.tar.gz      downloaded archive (kept for re-apply)
//   web-bundles/<version>.sha256      verified hash receipt
//   web-bundles/current.json          { version, dir } — active bundle
// Device state (DB, keys, credentials, backups) lives OUTSIDE web-bundles,
// so swapping bundles can never wipe data.

import { app } from "electron";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  downloadFile,
  fetchManifest,
  isNewerThan,
  parseSemver,
  sameHash,
  sha256File,
  type BundleManifest,
} from "./bundle-feed";

export type { BundleManifest };

export const BUNDLES_SUBDIR = "web-bundles";
const CURRENT_FILE = "current.json";
const FEED_FILE = "bundle-feed.json";

export type BundleStatus =
  | { state: "idle"; currentVersion: string; runningVersion: string | null }
  | { state: "checking"; currentVersion: string; runningVersion: string | null }
  | { state: "up-to-date"; currentVersion: string; runningVersion: string | null; manifest: BundleManifest }
  | { state: "available"; currentVersion: string; runningVersion: string | null; manifest: BundleManifest; downloaded: boolean }
  | { state: "downloading"; currentVersion: string; runningVersion: string | null; manifest: BundleManifest; progress: number }
  | { state: "ready"; currentVersion: string; runningVersion: string | null; manifest: BundleManifest }
  | { state: "applying"; currentVersion: string; runningVersion: string | null; manifest: BundleManifest }
  | { state: "applied"; currentVersion: string; runningVersion: string | null; manifest: BundleManifest }
  | { state: "error"; currentVersion: string; runningVersion: string | null; error: string };

type Logger = (msg: string) => void;

function shellVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

export function bundlesDir(userDataDir: string): string {
  return join(userDataDir, BUNDLES_SUBDIR);
}

function assertSafeVersion(version: string): void {
  if (!parseSemver(version)) throw new Error(`bad_version_dir: ${version}`);
}

export function versionDir(userDataDir: string, version: string): string {
  assertSafeVersion(version);
  return join(bundlesDir(userDataDir), version);
}

/// Feed URL priority: env override → <userData>/bundle-feed.json {url} →
/// baked default (same updates tree as the installer feed).
export function resolveFeedUrl(userDataDir: string, bakedDefault: string): string {
  const envUrl = (process.env.DISTRIBUILI_BUNDLE_URL || "").trim();
  if (envUrl) return envUrl;
  try {
    const raw = JSON.parse(readFileSync(join(userDataDir, FEED_FILE), "utf8")) as { url?: string };
    if (raw.url && /^https?:\/\//i.test(String(raw.url))) return String(raw.url);
  } catch {
    /* no override — fall through to baked default */
  }
  return bakedDefault;
}

export type BundleEntryPoints = {
  standaloneDir: string;
  serverEntry: string;
  generatedClient: string;
  ddlPath: string;
  seedDbPath: string;
};

/// A directory counts as a runnable bundle when the Next server entry +
/// the standalone .next tree are present.
export function isValidBundleDir(dir: string): boolean {
  return existsSync(join(dir, "server.js")) && existsSync(join(dir, ".next"));
}

export function entryPointsForDir(standaloneDir: string): BundleEntryPoints {
  return {
    standaloneDir,
    serverEntry: join(standaloneDir, "server.js"),
    generatedClient: join(standaloneDir, "src", "generated", "prisma-sqlite"),
    ddlPath: join(standaloneDir, "prisma", "sqlite-init.sql"),
    seedDbPath: join(standaloneDir, "prisma", "sqlite-seed.db"),
  };
}

/// Read the active-bundle receipt. Returns null when absent, corrupt, or
/// pointing at a directory that is no longer a valid bundle.
export function readActiveBundle(userDataDir: string): { version: string; dir: string } | null {
  try {
    const raw = JSON.parse(readFileSync(join(bundlesDir(userDataDir), CURRENT_FILE), "utf8")) as {
      version?: string;
      dir?: string;
    };
    if (!raw.version || !raw.dir || !parseSemver(raw.version)) return null;
    if (!isValidBundleDir(raw.dir)) return null;
    return { version: raw.version, dir: raw.dir };
  } catch {
    return null;
  }
}

function writeActiveBundle(userDataDir: string, version: string, dir: string): void {
  mkdirSync(bundlesDir(userDataDir), { recursive: true });
  writeFileSync(join(bundlesDir(userDataDir), CURRENT_FILE), JSON.stringify({ version, dir }), "utf8");
}

/// CHECK: fetch the manifest and compare with the shell version.
export async function checkBundleUpdate(
  userDataDir: string,
  feedUrl: string
): Promise<{ manifest: BundleManifest; newer: boolean }> {
  const manifest = await fetchManifest(feedUrl);
  return { manifest, newer: isNewerThan(manifest.version, shellVersion()) };
}

function tarballPath(userDataDir: string, version: string): string {
  return join(bundlesDir(userDataDir), `${version}.tar.gz`);
}

function receiptPath(userDataDir: string, version: string): string {
  return join(bundlesDir(userDataDir), `${version}.sha256`);
}

/// True when the version is fully on disk AND its hash receipt matches the
/// manifest (safe to apply without re-downloading).
export function isDownloaded(userDataDir: string, manifest: BundleManifest): boolean {
  try {
    const dir = versionDir(userDataDir, manifest.version);
    if (!isValidBundleDir(dir)) return false;
    if (!existsSync(tarballPath(userDataDir, manifest.version))) return false;
    const receipt = readFileSync(receiptPath(userDataDir, manifest.version), "utf8").trim();
    return sameHash(receipt, manifest.sha256);
  } catch {
    return false;
  }
}

function runTar(args: string[], log: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    // tar ships with macOS/Linux; Windows 10+ carries tar.exe in System32.
    execFile("tar", args, { timeout: 300000 }, (err, _stdout, stderr) => {
      if (err) {
        log(`[bundle] tar failed: ${String(stderr || err).slice(0, 500)}`);
        reject(new Error(`extract_failed: ${String(err.message || err)}`));
        return;
      }
      resolve();
    });
  });
}

/// DOWNLOAD: stream the tarball with progress, verify sha256, extract.
/// Never touches the running bundle until the new one verifies on disk.
export async function downloadBundle(
  userDataDir: string,
  manifest: BundleManifest,
  onProgress: (percent: number) => void,
  log: Logger
): Promise<string> {
  assertSafeVersion(manifest.version);
  mkdirSync(bundlesDir(userDataDir), { recursive: true });
  if (isDownloaded(userDataDir, manifest)) {
    log(`[bundle] ${manifest.version} already on disk + verified — no download`);
    return versionDir(userDataDir, manifest.version);
  }
  const tmp = `${tarballPath(userDataDir, manifest.version)}.part`;
  const dest = versionDir(userDataDir, manifest.version);
  log(`[bundle] downloading ${manifest.version} …`);
  await downloadFile(manifest.bundle_url, tmp, (done, total) => {
    onProgress(total ? Math.min(99, Math.round((done / total) * 100)) : 0);
  });
  const hash = await sha256File(tmp);
  if (!sameHash(hash, manifest.sha256)) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort */
    }
    throw new Error("hash_mismatch: bundle deleted, running version untouched");
  }
  // Fresh extract (a stale dir from an interrupted run must not mix in).
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  await runTar(["-xzf", tmp, "-C", dest], log);
  if (!isValidBundleDir(dest)) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error("bad_bundle: server.js/.next missing after extract");
  }
  // Commit: move verified archive + receipt into place (atomic-ish last step).
  try {
    rmSync(tarballPath(userDataDir, manifest.version), { force: true });
    rmSync(receiptPath(userDataDir, manifest.version), { force: true });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").renameSync(tmp, tarballPath(userDataDir, manifest.version));
  } catch {
    // Non-atomic fallback (e.g. Windows rename quirks): copy bytes over.
    const data = readFileSync(tmp);
    writeFileSync(tarballPath(userDataDir, manifest.version), data);
    rmSync(tmp, { force: true });
  }
  writeFileSync(receiptPath(userDataDir, manifest.version), manifest.sha256, "utf8");
  onProgress(100);
  log(`[bundle] ${manifest.version} verified + extracted`);
  return dest;
}

/// Mark a version dir as active (called AFTER the new server probes healthy).
export function activateBundle(userDataDir: string, version: string): string {
  const dir = versionDir(userDataDir, version);
  if (!isValidBundleDir(dir)) throw new Error("activate_failed: bundle dir invalid");
  writeActiveBundle(userDataDir, version, dir);
  return dir;
}

/// Prune old bundle dirs/archives, keeping the newest `keep` versions.
/// The running version is never deleted.
export function pruneBundles(userDataDir: string, runningVersion: string | null, keep = 2, log?: Logger): string[] {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(bundlesDir(userDataDir));
  } catch {
    return removed;
  }
  const versions = entries
    .filter((e) => {
      try {
        return parseSemver(e) !== null && statSync(join(bundlesDir(userDataDir), e)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const pa = parseSemver(a) ?? [0, 0, 0];
      const pb = parseSemver(b) ?? [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });
  for (const v of versions.slice(keep)) {
    if (v === runningVersion) continue;
    try {
      rmSync(versionDir(userDataDir, v), { recursive: true, force: true });
      rmSync(tarballPath(userDataDir, v), { force: true });
      rmSync(receiptPath(userDataDir, v), { force: true });
      removed.push(v);
    } catch (e) {
      log?.(`[bundle] prune ${v} failed: ${e}`);
    }
  }
  return removed;
}
