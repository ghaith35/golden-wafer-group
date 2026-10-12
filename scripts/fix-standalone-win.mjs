// Injects Windows x64 native bindings into the Next.js standalone server
// when packaging a Windows installer from macOS/Linux.
//
// Problem: `next build` traces the HOST platform's native modules, so
// .next/standalone/node_modules only contains e.g. @libsql/darwin-arm64.
// The shipped Windows server then crashes on boot (missing win32-x64
// binding) — the app sits on the splash screen forever ("not reachable").
//
// Usage: node scripts/fix-standalone-win.mjs --target=win|mac
//   --target=mac → no-op (host bindings are already correct).
//
// Strategy: `npm pack` the platform-specific optional packages with
// --os=win32 --cpu=x64 into a temp dir, then copy the binding folders into
// .next/standalone/node_modules. No network → warn (don't fail): the
// electron-prepare validation step will refuse to package a win build that
// still lacks win32 bindings, with a clear message.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const target = (process.argv.find((a) => a.startsWith("--target=")) || "").split("=")[1] || "";
if (target !== "win" && target !== "mac") {
  console.error("usage: node scripts/fix-standalone-win.mjs --target=win|mac");
  process.exit(1);
}
if (target !== "win") {
  console.log("✓ mac target — host native bindings already correct, nothing to do.");
  process.exit(0);
}

const STANDALONE_NM = resolve(ROOT, ".next/standalone/node_modules");
if (!existsSync(resolve(ROOT, ".next/standalone/server.js"))) {
  console.error("Missing .next/standalone/server.js — run `next build` first.");
  process.exit(1);
}

// Optional platform packages the traced server needs on Windows x64.
// Versions resolve from the project's own dependency tree (npm pack with the
// same range the lockfile picked). sharp is only needed if present.
const WANTED = ["@libsql/win32-x64-msvc", "libsql", "@img/sharp-win32-x64", "sharp"];
const COPIED = [];

let work = "";
try {
  work = mkdtempSync(join(tmpdir(), "dist-win-bindings-"));
  for (const spec of WANTED) {
    try {
      const tgz = execSync(`npm pack ${spec} --os=win32 --cpu=x64 --pack-destination ${work}`, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim().split("\n").pop()?.trim();
      if (!tgz) continue;
      const tgzPath = join(work, tgz);
      const outDir = join(work, "pkg");
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      execSync(`tar -xzf ${tgzPath} -C ${outDir}`);
      // npm pack layout: package/... → map back to node_modules scope path.
      const pkgName = spec.startsWith("@") ? spec : spec.split("@")[0];
      const dest = join(STANDALONE_NM, pkgName);
      mkdirSync(join(dest, ".."), { recursive: true });
      cpSync(join(outDir, "package"), dest, { recursive: true });
      COPIED.push(pkgName);
      console.log(`✓ injected win32-x64 binding: ${pkgName}`);
    } catch (e) {
      // sharp not installed / offline registry → only fatal if the traced
      // server actually requires it (checked by electron-prepare).
      console.error(`!! could not fetch ${spec} for win32-x64 (${String(e).split("\n")[0]}), skipping`);
    }
  }
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}

// The @libsql/* scope packages resolve the platform folder at runtime
// (@libsql/client → @libsql/win32-x64-msvc on win32/x64). Verify the key one.
const winBinding = join(STANDALONE_NM, "@libsql", "win32-x64-msvc");
if (!existsSync(winBinding)) {
  console.error(
    "!! @libsql/win32-x64-msvc still missing in .next/standalone/node_modules — " +
      "the Windows server WILL crash on boot. Check network access to the npm registry.",
  );
} else {
  console.log("✓ win32-x64 native bindings present in standalone server.");
}
