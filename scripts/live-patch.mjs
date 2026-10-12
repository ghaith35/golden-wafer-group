// Rapid live patch: ship web-only changes to the Mac server WITHOUT the full
// DMG pipeline (no electron build, no packaging — minutes instead of ~7).
//
//   node scripts/live-patch.mjs
//
// What it does:
//   1. `next build` (fails loudly on type/compile errors — nothing ships broken)
//   2. `electron-prepare` (static + public into standalone, offline-DB checks)
//   3. Backs up the installed bundle's .next, quits the app, copies the fresh
//      standalone .next + public over it, reopens, waits for /api/health.
//   4. On health failure: restores the backup and reopens (automatic rollback).
//
// RULES — use the full `dist:client:mac` pipeline instead when the change
// touches ANY of: electron/*, android/*, out-van/*, prisma/schema.prisma,
// package.json dependencies (new native modules are NOT in the bundle),
// build/*.yml, or needs a fresh seed DB. This script is for src/app,
// src/components, src/lib, src/locales, public/* web changes only.
import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const APP = "/Applications/Distribuili Local.app";
const BUNDLE_STANDALONE = resolve(APP, "Contents/Resources/app/.next/standalone");
const FRESH = resolve(ROOT, ".next/standalone");
const PORT = (() => {
  try {
    const fs = require("node:fs");
    const os = require("node:os");
    const f = resolve(os.homedir(), "Library/Application Support/distribuili/server-port.txt");
    const n = Number(fs.readFileSync(f, "utf8").trim());
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* default below */ }
  return 32517;
})();

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

function health() {
  const r = spawnSync("curl", ["-s", "-m", "8", "-o", "/dev/null", "-w", "%{http_code}", `http://127.0.0.1:${PORT}/api/health`], { encoding: "utf8" });
  return (r.stdout || "").trim() === "200";
}

if (!existsSync(APP)) {
  console.error(`app not installed at ${APP}`);
  process.exit(1);
}

console.log("▸ next build…");
sh("npx next build");
console.log("▸ electron-prepare…");
sh("node scripts/electron-prepare.mjs");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = resolve("/tmp", `dili-next-backup-${stamp}`);
console.log(`▸ backup bundle .next → ${backup}`);
mkdirSync("/tmp", { recursive: true });
rmSync(backup, { recursive: true, force: true });
cpSync(resolve(BUNDLE_STANDALONE, ".next"), backup, { recursive: true });

console.log("▸ quit app…");
try { execSync(`osascript -e 'tell application "Distribuili Local" to quit'`); } catch { /* was not running */ }
await new Promise((r) => setTimeout(r, 4000));

console.log("▸ copy fresh .next + public…");
// Wipe first: cpSync over the old tree dies on its node_modules symlinks
// (ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY) and leaves a half-copied bundle
// with the app quit. A parental backup exists above, so this is safe.
rmSync(resolve(BUNDLE_STANDALONE, ".next"), { recursive: true, force: true });
cpSync(resolve(FRESH, ".next"), resolve(BUNDLE_STANDALONE, ".next"), { recursive: true });
if (existsSync(resolve(FRESH, "public"))) {
  cpSync(resolve(FRESH, "public"), resolve(BUNDLE_STANDALONE, "public"), { recursive: true });
}

console.log("▸ reopen…");
execSync(`open "${APP}"`);
let ok = false;
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  if (health()) { ok = true; break; }
  console.log(`  …waiting (${i + 1}/12)`);
}

if (!ok) {
  console.error("!! health check failed — rolling back");
  try { execSync(`osascript -e 'tell application "Distribuili Local" to quit'`); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 4000));
  rmSync(resolve(BUNDLE_STANDALONE, ".next"), { recursive: true, force: true });
  renameSync(backup, resolve(BUNDLE_STANDALONE, ".next"));
  execSync(`open "${APP}"`);
  process.exit(1);
}
console.log(`✓ live on :${PORT} (backup kept at ${backup})`);
