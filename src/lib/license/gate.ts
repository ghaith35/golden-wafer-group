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

export type LocalEntitlement = { entitled: boolean; reason: "no-key" | "ok" | "expired" | "locked" | "bypass" };

/// Fresh evaluation from disk. Sticky lock file wins over everything.
export function localEntitlement(): LocalEntitlement {
  if (!isLocalMode()) return { entitled: true, reason: "bypass" };
  const dir = process.env.DISTRIBUILI_USERDATA;
  const machineId = process.env.DISTRIBUILI_MACHINE_ID;
  const pubkey = publicKey();
  if (!dir || !machineId || !pubkey) return { entitled: true, reason: "bypass" };
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
