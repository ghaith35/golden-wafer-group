// Sets the desktop product mode, baked into the installer via build-mode.json.
//   node scripts/set-mode.mjs <local|server> [serverUrl] [auto|manual]
// The 4th arg controls boot-time web-bundle updates: "auto" (connected
// flavors check + apply silently at boot) or "manual" (offline flavors:
// zero update traffic, Settings → Update only). Defaults to manual.
import { writeFileSync } from "node:fs";

const mode = process.argv[2] === "server" ? "server" : "local";
const serverUrl = process.argv[3] || "https://votre-domaine.com";
const bundleUpdates = process.argv[4] === "auto" ? "auto" : "manual";
writeFileSync("build-mode.json", JSON.stringify({ mode, serverUrl, bundleUpdates }, null, 2) + "\n");
console.log(`build mode: ${mode}${mode === "server" ? ` → ${serverUrl}` : ""} (bundle updates: ${bundleUpdates})`);
