// Sets the desktop product mode, baked into the installer via build-mode.json.
//   node scripts/set-mode.mjs <local|server> [serverUrl]
import { writeFileSync } from "node:fs";

const mode = process.argv[2] === "server" ? "server" : "local";
const serverUrl = process.argv[3] || "https://votre-domaine.com";
writeFileSync("build-mode.json", JSON.stringify({ mode, serverUrl }, null, 2) + "\n");
console.log(`build mode: ${mode}${mode === "server" ? ` → ${serverUrl}` : ""}`);
