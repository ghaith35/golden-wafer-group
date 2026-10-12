// Publishes a desktop release to the self-hosted update feed on server-c.
//   node scripts/upload-update.mjs [local|server] [client]
//
// Each release = installer(s) + .blockmap(s) + latest.yml (+ latest-mac.yml on
// mac). The .blockmap enables small differential downloads; without it every
// update is a full re-download. latest*.yml MUST be served with
// `Cache-Control: no-cache` — a stale cached yml is the #1 "update never
// detected" cause (the nginx location below already forces no-store).
//
// The optional [client] publishes a per-client feed to
// /var/www/distribuili-updates/<flavor>/<client>/ (baked into per-client
// installers by dist-client.mjs). Without it, publishes the shared flavor
// feed — which must only ever carry GENERIC builds, never a per-client
// installer (it would re-identity other clients on update).
//
// Each release = installer(s) + .blockmap(s) + latest.yml (+ latest-mac.yml on
// mac). The .blockmap enables small differential downloads; without it every
// update is a full re-download. latest*.yml MUST be served with
// `Cache-Control: no-cache` — a stale cached yml is the #1 "update never
// detected" cause (the nginx location below already forces no-store).
//
// What it does:
//   1. Discovers the exact artifact filenames by parsing dist-electron/
//      latest.yml + latest-mac.yml (robust across artifact renames).
//   2. Fails loudly if an installer or its .blockmap is missing.
//   3. Copies the files to /var/www/distribuili-updates/<flavor>/ on server-c.
//   4. Verifies the feed answers over HTTPS with no-cache headers.
//
// Env overrides: SSH_HOST (default server-c),
//   FEED_ROOT (default /var/www/distribuili-updates),
//   BASE_URL (default https://distribuili.khiatadz.com/updates).
// No credentials are committed here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist-electron");
const flavor = (process.argv[2] ?? "local").trim();
if (flavor !== "local" && flavor !== "server") {
  console.error("Usage: node scripts/upload-update.mjs [local|server] [client]");
  process.exit(1);
}
// Per-client feed: only that client's installer may land here.
const client = (process.argv[3] ?? "").trim();
if (client && !/^[a-z0-9][a-z0-9-_]{0,30}$/.test(client)) {
  console.error(`bad client id: ${client}`);
  process.exit(1);
}

const SSH = process.env.SSH_HOST ?? "server-c";
const FEED_ROOT = process.env.FEED_ROOT ?? "/var/www/distribuili-updates";
const BASE = (process.env.BASE_URL ?? "https://distribuili.khiatadz.com/updates").replace(/\/$/, "");
const remoteDir = client ? `${FEED_ROOT}/${flavor}/${client}` : `${FEED_ROOT}/${flavor}`;

function parseYmlUrls(file) {
  // Minimal reader for electron-builder's latest*.yml shape:
  // files:\n  - url: <name>\n  ...\npath: <name>
  const txt = readFileSync(join(DIST, file), "utf8");
  const urls = new Set();
  for (const m of txt.matchAll(/^\s*(?:-\s*url|path):\s*(.+?)\s*$/gm)) {
    urls.add(m[1].replace(/^["']|["']$/g, ""));
  }
  return [...urls];
}

const manifests = ["latest.yml", "latest-mac.yml"].filter((f) => existsSync(join(DIST, f)));
if (!manifests.includes("latest.yml")) {
  console.error(`Missing ${join(DIST, "latest.yml")} (run electron:dist first)`);
  process.exit(1);
}

// Flavor guard: dist-electron/latest*.yml always describes the LAST build, so
// refuse to publish a Local feed as server (and vice versa) — a Server install
// must never "update" into a Local build. Matches repaire's latest-server.yml
// split, implemented here by filename keyword. Per-client feeds additionally
// require the client id in every installer name (a generic or foreign-client
// installer must never land in a client's feed and re-identity it).
const flavorWord = flavor === "local" ? "local" : "server";
function manifestMatches(manifest) {
  const txt = readFileSync(join(DIST, manifest), "utf8");
  const installers = [...txt.matchAll(/^\s*(?:-\s*url|path):\s*(.+?)\s*$/gm)]
    .map((m) => m[1])
    .filter((u) => /\.(exe|dmg|zip)$/i.test(u));
  if (installers.length === 0) return false;
  if (client) {
    return installers.every((u) => u.toLowerCase().includes(client.toLowerCase()));
  }
  return installers.every((u) => u.toLowerCase().includes(flavorWord));
}

if (!manifestMatches("latest.yml")) {
  console.error(
    `dist-electron/latest.yml does not describe a ${flavor} build (build it first: electron:dist:${flavor}:win).`
  );
  process.exit(1);
}
const usableManifests = manifests.filter((m) => {
  const ok = manifestMatches(m);
  if (!ok) console.warn(`Skipping ${m} (not a ${flavor} feed — build the ${flavor} flavor to fill it).`);
  return ok;
});

const wanted = new Set(usableManifests);
for (const m of usableManifests) {
  for (const u of parseYmlUrls(m)) {
    const clean = u.split("?")[0].split("#")[0];
    wanted.add(clean);
    if (/\.(exe|dmg|zip)$/i.test(clean)) wanted.add(`${clean}.blockmap`);
  }
}

const missing = [...wanted].filter((f) => !existsSync(join(DIST, f)));
if (missing.length > 0) {
  console.error("Missing artifacts in dist-electron/:");
  for (const f of missing) console.error(" -", f);
  process.exit(1);
}

console.log(`Publishing ${flavor} feed (${wanted.size} files) to ${SSH}:${remoteDir}`);
execFileSync("ssh", [SSH, `mkdir -p ${remoteDir}`], { stdio: "inherit" });
for (const f of wanted) {
  console.log(" →", f);
  execFileSync("scp", ["-q", join(DIST, f), `${SSH}:${remoteDir}/${f}`], { stdio: "inherit" });
}

// Verify serving + no-cache.
const probe = client ? `${BASE}/${flavor}/${client}/latest.yml` : `${BASE}/${flavor}/latest.yml`;
try {
  const head = execFileSync("curl", ["-sI", "--max-time", "15", probe], { encoding: "utf8" });
  const versionLine = execFileSync("curl", ["-s", "--max-time", "30", probe], { encoding: "utf8" })
    .split("\n")
    .find((l) => l.startsWith("version:"));
  console.log("");
  console.log(probe);
  console.log((head.split("\n").find((l) => /^cache-control/i.test(l)) ?? "(no cache-control header!)").trim());
  console.log((versionLine ?? "(no version line!)").trim());
  if (!/no-store|no-cache/i.test(head)) {
    console.warn("WARNING: latest.yml is cacheable — clients may never see new versions.");
  }
} catch (e) {
  console.error(`Feed probe failed: ${probe} (${e.message})`);
  process.exit(1);
}
console.log("");
console.log("Done. Clients pick it up via Settings → Updates → Check (manual accept).");
