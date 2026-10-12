// Publishes a desktop WEB-BUNDLE release (no reinstall) to the self-hosted
// feed. Complements upload-update.mjs (full installers):
//   node scripts/publish-bundle.mjs [local|server]
//
// What it does:
//   1. Resolves the next patch version from the live bundle.json manifest
//      (falling back to package.json when the feed is unreachable).
//   2. Stages .next/standalone (run electron:prepare first) + injects every
//      desktop platform's native libsql bindings — a bundle built on macOS
//      must also boot on Windows/Linux, and a missing binding = hang at boot.
//      Each injected binary is magic-byte verified per platform.
//   3. Tars the stage to bundle-<version>.tar.gz, sha256-hashes it.
//   4. Uploads the tarball FIRST, then writes + uploads bundle.json LAST
//      (the feed never advertises a missing file). Keeps 3 newest archives.
//   5. Probes the manifest over HTTPS.
//
// Tarball URL must be direct (the desktop downloader does not follow
// redirects) — serve the flavor dir as static files with no-store on
// bundle.json.
//
// Env overrides: SSH_HOST (default server-c),
//   FEED_ROOT (default /var/www/distribuili-updates),
//   BASE_URL (default https://distribuili.khiatadz.com/updates).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";

const ROOT = process.cwd();
const flavor = (process.argv[2] ?? "local").trim();
if (flavor !== "local" && flavor !== "server") {
  console.error("Usage: node scripts/publish-bundle.mjs [local|server]");
  process.exit(1);
}

const SSH = process.env.SSH_HOST ?? "server-c";
const FEED_ROOT = process.env.FEED_ROOT ?? "/var/www/distribuili-updates";
const BASE = (process.env.BASE_URL ?? "https://distribuili.khiatadz.com/updates").replace(/\/$/, "");
const remoteDir = `${FEED_ROOT}/${flavor}`;
const MANIFEST = "bundle.json";

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", ...opts }).trim();
}

// ── 1. Next version ─────────────────────────────────────────────────────
function bumpPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`cannot bump non-semver ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

let version;
try {
  const live = JSON.parse(sh(`curl -s --max-time 20 ${BASE}/${flavor}/${MANIFEST}`));
  if (!/^(\d+)\.(\d+)\.(\d+)$/.test(live.version)) throw new Error("bad live version");
  version = bumpPatch(live.version);
  console.log(`live manifest at ${live.version} → publishing ${version}`);
} catch (e) {
  version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (!/^(\d+)\.(\d+)\.(\d+)$/.test(version)) {
    console.error(`Refusing to publish non-semver repo version ${version}`);
    process.exit(1);
  }
  console.log(`feed unreachable (${e.message?.slice(0, 80) || e}) — publishing repo version ${version}`);
}

// ── 2. Stage standalone + native bindings ───────────────────────────────
const SRC = join(ROOT, ".next", "standalone");
for (const f of ["server.js", ".next/BUILD_ID", "package.json"]) {
  if (!existsSync(join(SRC, f))) {
    console.error(`Missing ${join(SRC, f)} — run next build + electron:prepare first.`);
    process.exit(1);
  }
}
const stage = mkdtempSync(join(tmpdir(), "dili-bundle-"));
const stageRoot = join(stage, "bundle");
mkdirSync(stageRoot, { recursive: true });
console.log("staging standalone …");
cpSync(SRC, stageRoot, { recursive: true });

// NEVER ship these: Next copies the project .env into standalone (real
// secrets: DATABASE_URL, JWT_SECRET, LICENSE_PRIVATE_KEY…) and traces
// unrelated top-level dirs (android/). The tarball is served over plain
// HTTPS to every desktop — anything left here is public.
for (const junk of [".env", ".env.local", ".env.production", "android"]) {
  rmSync(join(stageRoot, junk), { recursive: true, force: true });
}

// Native libsql bindings per desktop platform. The dev machine only carries
// its own (@libsql/darwin-arm64 here); the rest are fetched at the exact
// version pinned by the installed @libsql/client.
// Native bindings live in the `libsql` package — NOT @libsql/client's own
// version (the JS wrapper and the native driver are versioned apart:
// client 0.17.x pairs with native libsql 0.5.x, whose platform packages
// actually exist on the registry).
let libsqlVersion = null;
for (const parts of [["libsql"], ["@libsql", "client"]]) {
  try {
    const v = JSON.parse(readFileSync(join(ROOT, "node_modules", ...parts, "package.json"), "utf8")).version;
    if (/^\d+\.\d+\.\d+$/.test(v)) {
      libsqlVersion = v;
      break;
    }
  } catch { /* try next source */ }
}
if (!libsqlVersion) {
  console.error("FATAL: cannot resolve the libsql native version (looked in libsql, @libsql/client).");
  process.exit(1);
}
console.log(`native bindings target: libsql@${libsqlVersion}`);
const PLATFORMS = [
  { pkg: "@libsql/darwin-arm64", magic: [[0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]], ext: "dylib+binary" },
  { pkg: "@libsql/darwin-x64", magic: [[0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]], ext: "dylib+binary" },
  { pkg: "@libsql/linux-x64-gnu", magic: [[0x7f, 0x45, 0x4c, 0x46]], ext: ".node/.so" },
  { pkg: "@libsql/win32-x64-msvc", magic: [[0x4d, 0x5a]], ext: ".dll/.node" },
];

function findBinaries(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of sh(`find ${dir} -type f \\( -name '*.node' -o -name '*.so' -o -name '*.dylib' -o -name '*.dll' \\)`).split("\n")) {
    if (e.trim()) out.push(e.trim());
  }
  return out;
}

function magicOk(file, magics) {
  const buf = readFileSync(file);
  return magics.some((m) => m.every((b, i) => buf[i] === b));
}

for (const p of PLATFORMS) {
  // Already present (e.g. the build machine's own platform)?
  const present = findBinaries(join(stageRoot, "node_modules", p.pkg));
  if (present.length > 0 && present.every((f) => magicOk(f, p.magic))) {
    console.log(`✓ ${p.pkg} already staged (${present.length} binary)`);
    continue;
  }
  console.log(`fetching ${p.pkg}@${libsqlVersion} …`);
  const packDir = mkdtempSync(join(tmpdir(), "dili-npm-"));
  try {
    sh(`npm pack ${p.pkg}@${libsqlVersion} --pack-destination ${packDir} --silent`);
    sh(`tar -xzf ${packDir}/*.tgz -C ${packDir}`);
    const target = join(stageRoot, "node_modules", p.pkg);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(join(stageRoot, "node_modules", "@libsql"), { recursive: true });
    cpSync(join(packDir, "package"), target, { recursive: true });
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
  const bins = findBinaries(join(stageRoot, "node_modules", p.pkg));
  if (bins.length === 0) {
    console.error(`FATAL: ${p.pkg} delivered no native binary — refusing to ship a bundle that hangs at boot.`);
    process.exit(1);
  }
  const bad = bins.filter((f) => !magicOk(f, p.magic));
  if (bad.length > 0) {
    console.error(`FATAL: magic-byte mismatch in ${p.pkg} (${p.ext} expected):\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`✓ ${p.pkg} verified (${bins.length} binary, ${p.ext})`);
}

// ── 3. Tar + hash ───────────────────────────────────────────────────────
// Completeness gate: a stage that boots-but-500s (partial driver copy —
// Turbopack can't trace eval-requires) must never ship. Fail here, loudly,
// instead of stranding clients on the "Switching…" screen.
for (const f of [
  "server.js",
  "src/generated/prisma-sqlite/index.js",
  "prisma/sqlite-init.sql",
  "node_modules/@prisma/adapter-libsql/dist/index-node.js",
  "node_modules/@prisma/client-runtime-utils/dist/index.js",
  "node_modules/libsql/index.js",
  "node_modules/@libsql/client/lib-cjs/node.js",
]) {
  if (!existsSync(join(stageRoot, f))) {
    console.error(`FATAL: staged bundle missing ${f} — refusing to ship an unbootable bundle.`);
    process.exit(1);
  }
}
console.log("✓ staged bundle completeness check passed.");

// ── Boot gate: boot the STAGED server exactly like the desktop shell does
// (same env contract as electron/main.ts startServer) and probe /api/health.
// A bundle that 500s here is what strands clients on "Switching…" — refuse
// to upload it. Runs on the build machine's own platform binding.
{
  const { spawn } = await import("node:child_process");
  const probeDb = join(stage, "probe.db");
  try {
    cpSync(join(stageRoot, "prisma", "sqlite-seed.db"), probeDb);
  } catch {
    writeFileSync(probeDb, "");
  }
  const port = 39511;
  const bootLog = join(stage, "boot-probe.log");
  const logFd = openSync(bootLog, "w");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: stageRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DISTRIBUILI_DB: "local",
      DISTRIBUILI_SQLITE_URL: `file:${probeDb}`,
      DISTRIBUILI_SQLITE_CLIENT: join(stageRoot, "src", "generated", "prisma-sqlite"),
      DISTRIBUILI_USERDATA: join(stage, "probe-ud"),
      DISTRIBUILI_MACHINE_ID: "probe-machine",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", logFd, logFd],
  });
  const healthy = await new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(false), 55000);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (r.ok) {
          clearTimeout(deadline);
          clearInterval(poll);
          resolve(true);
        }
      } catch {
        /* not up yet */
      }
    }, 500);
  });
  try {
    child.kill();
  } catch {
    /* already dead */
  }
  try {
    closeSync(logFd);
  } catch {
    /* ignore */
  }
  rmSync(probeDb, { force: true });
  if (!healthy) {
    console.error("FATAL: staged bundle failed its /api/health boot probe — refusing to upload.");
    try {
      const tail = readFileSync(bootLog, "utf8").split("\n").slice(-15).join("\n");
      console.error("--- boot log tail ---\n" + tail);
    } catch {
      /* no log */
    }
    process.exit(1);
  }
  console.log("✓ staged bundle boot probe passed (/api/health 200).");
}
const archive = `bundle-${version}.tar.gz`;
const archivePath = join(stage, archive);
sh(`tar -czf ${archivePath} -C ${stageRoot} .`);
const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
console.log(`✓ ${archive} sha256:${sha256.slice(0, 16)}…`);

// ── 4. Upload tarball FIRST, manifest LAST ──────────────────────────────
console.log(`uploading to ${SSH}:${remoteDir}`);
execFileSync("ssh", [SSH, `mkdir -p ${remoteDir}`], { stdio: "inherit" });
execFileSync("scp", ["-q", archivePath, `${SSH}:${remoteDir}/${archive}`], { stdio: "inherit" });
const manifest = {
  version,
  bundle_url: `${BASE}/${flavor}/${archive}`,
  sha256,
  builtAt: new Date().toISOString(),
};
const manifestPath = join(stage, MANIFEST);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
execFileSync("scp", ["-q", manifestPath, `${SSH}:${remoteDir}/${MANIFEST}`], { stdio: "inherit" });

// Keep the 3 newest archives (never touch bundle.json / latest*.yml).
try {
  const remote = execFileSync("ssh", [SSH, `ls -1 ${remoteDir}/bundle-*.tar.gz`], { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  for (const old of remote.slice(0, Math.max(0, remote.length - 3))) {
    console.log("pruning", old.split("/").pop());
    execFileSync("ssh", [SSH, `rm -f ${old}`], { stdio: "inherit" });
  }
} catch (e) {
  console.warn(`prune skipped: ${e.message}`);
}

// ── 5. Probe ────────────────────────────────────────────────────────────
const probe = `${BASE}/${flavor}/${MANIFEST}`;
const got = JSON.parse(sh(`curl -s --max-time 30 ${probe}`));
if (got.version !== version || got.sha256 !== sha256) {
  console.error(`FATAL: live manifest mismatch: ${JSON.stringify(got).slice(0, 200)}`);
  process.exit(1);
}
console.log(`✓ live ${probe} → ${got.version} (hash matches)`);
rmSync(stage, { recursive: true, force: true });
console.log("Done. Desktop clients pick it up via Settings → Updates (web track).");
