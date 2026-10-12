// Post-compile hardening for the Electron MAIN process. The main-process JS holds
// the pre-boot license verifier (electron/license.ts) + the sticky lock flag, and
// after packaging it lives inside app.asar as readable JS. We obfuscate it so the
// license logic can't be casually read or patched, and enable `selfDefending` so a
// beautified/edited copy breaks at runtime (anti-tamper). Wired into
// `electron:build:main` (runs right after tsc). preload.js is left untouched — it
// is just the contextBridge IPC surface and holds no secrets.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import JavaScriptObfuscator from 'javascript-obfuscator'

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'dist')
const FILES = ['main.js', 'license.js']

// Bake the REAL license public key into license.js BEFORE obfuscating.
// (Must happen here: stringArray/base64 + splitStrings encoding makes the
// REPLACE_AT_DEPLOY placeholder unfindable afterwards, so the old
// post-obfuscation replace in electron-prepare.mjs silently never fired and
// every shipped build stayed license-inert.)
// Source: LICENSE_PUBLIC_KEY env, else derived from LICENSE_PRIVATE_KEY.
const PLACEHOLDER = 'REPLACE_AT_DEPLOY'
{
  const licPath = join(distDir, 'license.js')
  if (existsSync(licPath) && readFileSync(licPath, 'utf8').includes(PLACEHOLDER)) {
    let pubB64 = (process.env.LICENSE_PUBLIC_KEY || '').trim()
    if (!pubB64 && process.env.LICENSE_PRIVATE_KEY) {
      try {
        const { createPublicKey } = await import('node:crypto')
        const priv = createPublicKey({
          key: Buffer.from(process.env.LICENSE_PRIVATE_KEY.trim(), 'base64'),
          format: 'der',
          type: 'pkcs8',
        })
        pubB64 = priv.export({ format: 'der', type: 'spki' }).toString('base64')
      } catch (e) {
        console.error('[obfuscate] could not derive public key from LICENSE_PRIVATE_KEY:', String(e))
      }
    }
    if (!pubB64) {
      if (process.env.ALLOW_UNLICENSED_BUILD === '1') {
        console.error('[obfuscate] !! ALLOW_UNLICENSED_BUILD=1 — packaged app will be LICENSE-INERT (dev bypass).')
      } else {
        console.error(
          '[obfuscate] !! No LICENSE_PUBLIC_KEY (or LICENSE_PRIVATE_KEY) in env — refusing to build an\n' +
          '[obfuscate] !! unlicensed installer. Set the key, or pass ALLOW_UNLICENSED_BUILD=1 for a dev build.',
        )
        process.exit(1)
      }
    } else {
      // Targeted: only the const initializer — never the comparison literal
      // inside isPlaceholder() (replacing that too would make every build
      // report dev-bypass forever).
      const before = readFileSync(licPath, 'utf8')
      const after = before.replace(
        /(DISTRIBUILI_LICENSE_PUBLIC_KEY_DER_B64\s*=\s*")REPLACE_AT_DEPLOY(")/,
        (_, a, b) => `${a}${pubB64}${b}`,
      )
      if (after === before) {
        console.error('[obfuscate] !! placeholder initializer not found in license.js — refusing to package blind.')
        process.exit(1)
      }
      writeFileSync(licPath, after, 'utf8')
      console.log('[obfuscate] ✓ license public key baked into license.js (pre-obfuscation)')
    }
  } else if (existsSync(licPath)) {
    console.log('[obfuscate] ✓ license.js already carries a key')
  }
}

/** @type {import('javascript-obfuscator').ObfuscatorOptions} */
// AV-FRIENDLY defaults (2026-10): the previous profile (controlFlowFlattening
// + selfDefending + base64 stringArray) is a top Windows Defender heuristic
// trigger (Obfuse/Wacatac) — unsigned + obfuscated + Winlogon writes +
// bundled cloudflared got the .exe quarantined on Windows 11. The license
// gate does NOT depend on obscurity (Ed25519 server-signed tokens verified
// at runtime), so we keep only light renaming. Full hardening stays
// available via DIST_OBFUSCATE_HARD=1 (only meaningful WITH code signing).
const HARD = process.env.DIST_OBFUSCATE_HARD === '1'
const options = HARD
  ? {
      target: 'node',
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      deadCodeInjection: false,
      selfDefending: true,          // edited/beautified copy breaks at runtime (anti-tamper)
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75,
      splitStrings: true,
      splitStringsChunkLength: 8,
      numbersToExpressions: true,
      simplify: true,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: true,
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
    }
  : {
      target: 'node',
      compact: true,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      selfDefending: false,
      stringArray: false,
      splitStrings: false,
      numbersToExpressions: false,
      simplify: true,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: true,
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
    }
if (!HARD) console.log('[obfuscate] light (AV-friendly) profile — set DIST_OBFUSCATE_HARD=1 for full hardening (requires code signing)')

let done = 0
for (const f of FILES) {
  const p = join(distDir, f)
  if (!existsSync(p)) { console.warn(`[obfuscate] skip (missing): ${f}`); continue }
  const src = readFileSync(p, 'utf8')
  const out = JavaScriptObfuscator.obfuscate(src, options).getObfuscatedCode()
  writeFileSync(p, out, 'utf8')
  console.log(`[obfuscate] ${f}: ${src.length} -> ${out.length} bytes`)
  done++
}
if (!done) { console.error('[obfuscate] nothing obfuscated — did tsc run?'); process.exit(1) }
