// Downloads cloudflared connector binaries into build/bin/<platform>/.
//   node scripts/fetch-cloudflared.mjs [--only mac-arm64|mac-x64|win-x64]
// Sources: https://github.com/cloudflare/cloudflared/releases (latest).
// Requires: curl + tar on PATH. Output is gitignored (per-machine cache).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";

const TARGETS = {
  "mac-arm64": { file: "cloudflared-darwin-arm64.tgz", out: "build/bin/darwin-arm64/cloudflared", tgz: true },
  "mac-x64": { file: "cloudflared-darwin-amd64.tgz", out: "build/bin/darwin-amd64/cloudflared", tgz: true },
  "win-x64": { file: "cloudflared-windows-amd64.exe", out: "build/bin/win-x64/cloudflared.exe", tgz: false },
};

const BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download";

for (const [name, t] of Object.entries(TARGETS)) {
  if (only && only !== name) continue;
  const dest = resolve(ROOT, t.out);
  if (existsSync(dest)) {
    console.log(`✓ ${name} already present`);
    continue;
  }
  mkdirSync(resolve(ROOT, t.out, ".."), { recursive: true });
  console.log(`↓ ${name} …`);
  if (t.tgz) {
    execSync(`curl -fsSL ${BASE}/${t.file} -o /tmp/cfd-${name}.tgz && tar -xzf /tmp/cfd-${name}.tgz -C /tmp cloudflared && mv /tmp/cloudflared ${dest} && chmod +x ${dest} && rm -f /tmp/cfd-${name}.tgz`, { stdio: "inherit" });
  } else {
    execSync(`curl -fsSL ${BASE}/${t.file} -o ${dest}`, { stdio: "inherit" });
  }
  console.log(`✓ ${dest}`);
}
