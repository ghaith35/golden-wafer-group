// Local trial packager for the web-bundle updater (no SSH/feed needed):
//   node scripts/trial-bundle.mjs [version]
//
// Tars the prepared .next/standalone into trial-feed/bundle-<v>.tar.gz and
// writes trial-feed/bundle.json pointing at http://127.0.0.1:8901/.
// Serve it with:  python3 -m http.server 8901 --directory trial-feed
// Then point a test install at it via <userData>/bundle-feed.json:
//   { "url": "http://127.0.0.1:8901/bundle.json" }
// (http tarballs are accepted on loopback only.)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const version = (process.argv[2] ?? "0.1.2").trim();
if (!/^(\d+)\.(\d+)\.(\d+)$/.test(version)) {
  console.error("version must be strict semver, e.g. 0.1.2");
  process.exit(1);
}
const SRC = join(ROOT, ".next", "standalone");
if (!existsSync(join(SRC, "server.js"))) {
  console.error("Missing .next/standalone/server.js — run: npm run build && npm run electron:prepare");
  process.exit(1);
}
const FEED = join(ROOT, "trial-feed");
mkdirSync(FEED, { recursive: true });
const archive = `bundle-${version}.tar.gz`;
execSync(`tar -czf ${join(FEED, archive)} -C ${SRC} .`, { stdio: "inherit" });
const sha256 = createHash("sha256").update(readFileSync(join(FEED, archive))).digest("hex");
writeFileSync(
  join(FEED, "bundle.json"),
  JSON.stringify({ version, bundle_url: `http://127.0.0.1:8901/${archive}`, sha256, builtAt: new Date().toISOString() }, null, 2) + "\n"
);
console.log(`trial feed ready: ${archive} (${sha256.slice(0, 12)}…)`);
console.log("serve: python3 -m http.server 8901 --directory trial-feed");
