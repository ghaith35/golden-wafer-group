import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/// Server-side license gate (Node runtime only — never import from proxy/edge).
/// Verifies the local install's .lic files against the baked public key.
/// Only applies to Electron local installs (DISTRIBUILI_DB === "local"):
/// central/vendor installs and plain dev servers are never gated.

export function isLocalMode(): boolean {
  return process.env.DISTRIBUILI_DB === "local";
}

/// Desktop-shell detection: the Electron BrowserWindow sends the default
/// Chromium UA containing "Electron/<ver>" — phone/desktop browsers never do
/// (tunnel + LAN proxy it transparently). Phone traffic skips the activation
/// gates below; the desktop shell stays fully gated.
export function isDesktopUserAgent(ua: string | null | undefined): boolean {
  return /electron/i.test(ua ?? "");
}

function publicKey(): crypto.KeyObject | null {
  const b64 = process.env.DISTRIBUILI_LICENSE_PUBLIC_KEY;
  if (!b64 || b64 === "REPLACE_AT_DEPLOY") return null;
  try {
    return crypto.createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
  } catch {
    return null;
  }
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function verifySig(token: string, pubkey: crypto.KeyObject): Record<string, unknown> | null {
  try {
    const [p, s] = token.trim().split(".");
    if (!p || !s) return null;
    if (!crypto.verify(null, Buffer.from(p, "utf8"), pubkey, fromB64url(s))) return null;
    return JSON.parse(fromB64url(p).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTrim(p: string): string | null {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() || null : null;
  } catch {
    return null;
  }
}

/// Desktop activation was REMOVED: every install is entitled — no key, trial or
/// lock. The license machinery below stays in the repo (flip this to true to
/// enforce it again); the Electron shell has the same switch in electron/main.ts.
export const LICENSE_ENFORCED = false;

export type LocalEntitlement = { entitled: boolean; reason: "no-key" | "ok" | "expired" | "locked" | "bypass" };

/// Fresh evaluation from disk. Sticky lock file wins over everything.
export function localEntitlement(): LocalEntitlement {
  if (!LICENSE_ENFORCED || !isLocalMode()) return { entitled: true, reason: "bypass" };
  const dir = process.env.DISTRIBUILI_USERDATA;
  const machineId = process.env.DISTRIBUILI_MACHINE_ID;
  // Not an Electron install → never gated (central/vendor/dev servers).
  if (!dir || !machineId) return { entitled: true, reason: "bypass" };
  const pubkey = publicKey();
  // Local install with no baked public key must FAIL CLOSED — otherwise a
  // release built without the key would be license-inert (everyone entitled).
  // Dev override: DISTRIBUILI_LICENSE_BYPASS=1.
  if (!pubkey) {
    if (process.env.DISTRIBUILI_LICENSE_BYPASS === "1") return { entitled: true, reason: "bypass" };
    return { entitled: false, reason: "no-key" };
  }
  if (readTrim(path.join(dir, "revoked.flag"))) return { entitled: false, reason: "locked" };
  const act = readTrim(path.join(dir, "activation.lic"));
  if (act) {
    const p = verifySig(act, pubkey);
    if (p && p.v === 1 && p.machineId === machineId && (p as { kind?: string }).kind !== "trial") {
      return { entitled: true, reason: "ok" };
    }
  }
  const trial = readTrim(path.join(dir, "trial.lic"));
  if (trial) {
    const p = verifySig(trial, pubkey);
    if (p && p.kind === "trial" && p.v === 1 && p.machineId === machineId && typeof p.trialEnd === "string") {
      // Monotonic clock: a rolled-back system clock can't revive a trial.
      const systemNow = Date.now();
      let hw = 0;
      const raw = readTrim(path.join(dir, "clock.hw"));
      if (raw) hw = Number(raw) || 0;
      const now = Math.max(systemNow, hw);
      if (now <= new Date(p.trialEnd).getTime()) {
        return { entitled: true, reason: "ok" };
      }
      return { entitled: false, reason: "expired" };
    }
  }
  return { entitled: false, reason: "no-key" };
}

/// The activation key this install was activated with (from the signed
/// activation.lic). null when not activated with a key, trial-only, or not a
/// desktop install. Used to prove ownership for the password reset.
export function readLocalActivationKey(): string | null {
  if (!isLocalMode()) return null;
  const dir = process.env.DISTRIBUILI_USERDATA;
  const machineId = process.env.DISTRIBUILI_MACHINE_ID;
  const pubkey = publicKey();
  if (!dir || !machineId || !pubkey) return null;
  const act = readTrim(path.join(dir, "activation.lic"));
  if (!act) return null;
  const p = verifySig(act, pubkey);
  if (!p || p.v !== 1 || p.machineId !== machineId || (p as { kind?: string }).kind === "trial") return null;
  const key = (p as { key?: unknown }).key;
  return typeof key === "string" && key.trim() ? key : null;
}

/// Throw a 402 for locked local installs. Call at the top of mutating routes
/// (reads are left open — the UI gate steers humans to /activate).
export function assertLocalEntitled(): void {
  const e = localEntitlement();
  if (!e.entitled) throw Object.assign(new Error("not_entitled"), { status: 402 });
}

// ── Proxy fast path ─────────────────────────────────────────────────────────
// Short-TTL cache: the proxy runs this on EVERY api call (sync-heavy vans).
let cached: { at: number; entitled: boolean } | null = null;

/// Cached entitlement verdict for hot paths (5s TTL — far below the 30s
/// revocation poll, so lock propagation stays prompt).
export function localEntitledCached(): boolean {
  const now = Date.now();
  if (cached && now - cached.at < 5000) return cached.entitled;
  const entitled = localEntitlement().entitled;
  cached = { at: now, entitled };
  return entitled;
}
