// Prepares the Next.js standalone output for Electron packaging.
//
// `next build` with output:"standalone" emits a self-contained server but does
// NOT copy static assets — they must be placed next to server.js. This also
// confirms the offline-DB resources (generated SQLite client + DDL + seed DB)
// were traced in via next.config's outputFileTracingIncludes.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicKey } from "node:crypto";
import { resolve } from "node:path";

const ROOT = process.cwd();
const STANDALONE = resolve(ROOT, ".next/standalone");

if (!existsSync(resolve(STANDALONE, "server.js"))) {
  console.error("Missing .next/standalone/server.js — run `next build` first.");
  process.exit(1);
}

// Static assets (CSS/JS chunks) and public/ files.
cpSync(resolve(ROOT, ".next/static"), resolve(STANDALONE, ".next/static"), {
  recursive: true,
});
if (existsSync(resolve(ROOT, "public"))) {
  cpSync(resolve(ROOT, "public"), resolve(STANDALONE, "public"), { recursive: true });
}

// Sanity-check the offline-DB resources that Electron's first run depends on.
const required = [
  ".next/standalone/prisma/sqlite-init.sql",
  ".next/standalone/src/generated/prisma-sqlite/index.js",
  ".next/standalone/prisma/sqlite-seed.db",
];
const missing = required.filter((p) => !existsSync(resolve(ROOT, p)));
if (missing.length) {
  console.error(
    "Standalone is missing offline-DB resources (check next.config tracing):\n  " +
      missing.join("\n  "),
  );
  process.exit(1);
}

console.log("✓ standalone prepared for Electron (static, public, offline-db resources).");

// Bake the REAL license public key into the built main-process bundle.
// Source: LICENSE_PUBLIC_KEY env, else derived from LICENSE_PRIVATE_KEY.
// Without this every shipped EXE verifies against REPLACE_AT_DEPLOY and
// stays license-inert (dev bypass). Refuses to package silently: warns loud.
const PLACEHOLDER = "REPLACE_AT_DEPLOY";
let pubB64 = (process.env.LICENSE_PUBLIC_KEY || "").trim();
if (!pubB64 && process.env.LICENSE_PRIVATE_KEY) {
  try {
    const priv = createPublicKey({
      key: Buffer.from(process.env.LICENSE_PRIVATE_KEY.trim(), "base64"),
      format: "der",
      type: "pkcs8",
    });
    pubB64 = priv.export({ format: "der", type: "spki" }).toString("base64");
  } catch (e) {
    console.error("Could not derive public key from LICENSE_PRIVATE_KEY:", String(e));
  }
}
const licenseJs = resolve(ROOT, "electron/dist/license.js");
if (existsSync(licenseJs)) {
  const src = readFileSync(licenseJs, "utf8");
  if (src.includes(PLACEHOLDER)) {
    if (!pubB64) {
      console.error(
        "!! No LICENSE_PUBLIC_KEY (or LICENSE_PRIVATE_KEY) in env — packaged EXE will be LICENSE-INERT (dev bypass).",
      );
    } else {
      writeFileSync(licenseJs, src.split(PLACEHOLDER).join(pubB64), "utf8");
      console.log("✓ license public key baked into electron/dist/license.js");
    }
  } else {
    console.log("✓ electron/dist/license.js already carries a key");
  }
}
