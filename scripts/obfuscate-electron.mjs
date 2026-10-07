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

/** @type {import('javascript-obfuscator').ObfuscatorOptions} */
const options = {
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
  // Rename top-level function/var names too (hides `entitled`, `getEntitlement`,
  // etc. — otherwise a cracker can still grep for them). Exported PROPERTY names
  // stay intact (transformObjectKeys:false), so `require('./license')` and every
  // `license.verifyActivationToken(...)` call site keeps resolving.
  renameGlobals: true,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
}

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
