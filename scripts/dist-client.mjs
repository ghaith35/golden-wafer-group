// Per-client installer build.
//   node scripts/dist-client.mjs --target mac|win
// Requires build-client.json (see scripts/set-client.mjs) + the matching
// connector binary (scripts/fetch-cloudflared.mjs). Stages everything under
// build/stage/ (gitignored) so electron-builder picks it up, then builds with
// a per-client artifact name: Distribuili-<client>-<version>-<arch>.dmg/.exe
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const target = (process.argv.find((a) => a.startsWith("--target=")) || "").split("=")[1] || "";
if (target !== "mac" && target !== "win") {
  console.error("usage: node scripts/dist-client.mjs --target=mac|win");
  process.exit(1);
}

const idPath = resolve(ROOT, "build-client.json");
if (!existsSync(idPath)) {
  console.error("missing build-client.json — run: node scripts/set-client.mjs <client> <domain> [token]");
  process.exit(1);
}
const id = JSON.parse(readFileSync(idPath, "utf8"));
if (!id.client || !id.domain) {
  console.error("build-client.json incomplete — re-run scripts/set-client.mjs");
  process.exit(1);
}

const STAGE = resolve(ROOT, "build/stage");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(resolve(STAGE, "bin"), { recursive: true });
import("node:fs").then(({ writeFileSync }) => {
  writeFileSync(resolve(STAGE, "build-client.json"), JSON.stringify(id, null, 2) + "\n");
});

// Stage the connector binary for this target (fatal if missing — a client
// installer without its tunnel cannot serve phones over the internet).
const BIN = {
  mac: ["build/bin/darwin-arm64/cloudflared", "bin/cloudflared"],
  win: ["build/bin/win-x64/cloudflared.exe", "bin/cloudflared.exe"],
}[target];
const src = resolve(ROOT, BIN[0]);
if (!existsSync(src)) {
  console.error(`missing connector ${BIN[0]} — run: node scripts/fetch-cloudflared.mjs`);
  process.exit(1);
}
cpSync(src, resolve(STAGE, BIN[1]));
if (target === "mac") execSync(`chmod +x ${resolve(STAGE, BIN[1])}`);

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const ext = target === "mac" ? "dmg" : "exe";
const artifact = `Distribuili-${id.client}-${pkg.version}-\${arch}.${ext}`;
console.log(`building ${id.client} (${id.domain}) → ${artifact.replace("${arch}", target === "mac" ? "arm64" : "x64")}`);

// Full pipeline (mirrors electron:dist:local:mac), then package.
// electron:prepare keeps our staged identity (only defaults when missing).
// Slim desktop standalone: skip the pg chain + Prisma engines (never used
// in local mode) — see next.config.ts. Inherited by every child below.
process.env.DISTRIBUILI_DESKTOP_BUILD = "1";
execSync("node scripts/set-mode.mjs local", { stdio: "inherit", cwd: ROOT });
execSync("npm run db:sqlite:build", { stdio: "inherit", cwd: ROOT });
execSync("npm run electron:build", { stdio: "inherit", cwd: ROOT });
execSync("npm run electron:build:seed", { stdio: "inherit", cwd: ROOT });
// Win target: inject win32-x64 native bindings into the standalone server
// (built on macOS it only carries darwin-arm64 .node files → the server
// child crashes on Windows and the app is "not reachable"). No-op on mac.
execSync(`node scripts/fix-standalone-win.mjs --target=${target}`, { stdio: "inherit", cwd: ROOT });
execSync(`node scripts/electron-prepare.mjs --target=${target}`, { stdio: "inherit", cwd: ROOT });

const cliOverrides =
  target === "mac"
    ? `-c.dmg.artifactName='${artifact}' -c.mac.artifactName='${artifact}'`
    : `-c.nsis.artifactName='Distribuili-${id.client}-Setup-${pkg.version}.` + "${ext}'";

// Per-client update feed: the installed shell checks
// <BASE_URL>/local/<client>/latest.yml (baked into app-update.yml), so one
// client's installer can never "update" another client into its identity.
// Served by the same /updates/ location (no-store) — no server change needed.
// Publish with: node scripts/upload-update.mjs local <client>.
const feedUrl = `https://distribuili.khiatadz.com/updates/local/${id.client}`;
const feedOverride = `-c.publish.url='${feedUrl}'`;

// ARCH: Windows shop PCs are x64. electron-builder on an ARM Mac defaults to
// arm64 (an ARM64 .exe that CANNOT run on x64 Windows — app never starts,
// "not reachable"). Always pin the arch explicitly. The win native .node
// overlay is injected by electron-prepare --target=win (see
// scripts/fix-standalone-win.mjs) — without it the server child crashes on
// missing win32-x64 bindings even when the arch is right.
const archFlag = target === "mac" ? "--arm64" : "--x64";

execSync(
  `npx electron-builder --${target} ${archFlag} --config electron-builder.local.yml ` + cliOverrides + ` ${feedOverride}`,
  { stdio: "inherit", cwd: ROOT },
);
