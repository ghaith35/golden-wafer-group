// Publishes a desktop build to the generic update feed.
//   UPDATE_URL=https://updates.distribuili.dz/latest node scripts/upload-update.mjs [dist-electron]
// The dir must contain the installer + latest.yml (+ .blockmap for diff updates).
// Serve latest.yml with `Cache-Control: no-cache` or clients see stale versions.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "dist-electron";
const url = (process.env.UPDATE_URL || "").trim();
if (!url) {
  console.error("Set UPDATE_URL first (the public feed base URL).");
  process.exit(1);
}
if (!existsSync(dir)) {
  console.error(`Missing dir: ${dir} (run electron:dist first)`);
  process.exit(1);
}
console.log(`Feed contents (${dir}):`);
for (const f of readdirSync(dir)) console.log(" -", f);
console.log("");
console.log("Upload every file in this dir to the feed root so that:");
console.log(`  ${url}/latest.yml          (no-cache!)`);
console.log(`  ${url}/<Setup>.exe + .blockmap`);
console.log(`  ${url}/<App>.dmg + latest-mac.yml`);
console.log("");
console.log("Clients pick it up via Settings → Updates (manual accept).");
console.log(`Override per install: DISTRIBUILI_UPDATE_URL env or <userData>/update-feed.json {"url": "..."}.`);
void join;
