import crypto from "node:crypto";

// Server-side license signing (private key NEVER leaves the server).
// Token format mirrors the Electron verifier: b64url(payload).b64url(sig).

function privateKey(): crypto.KeyObject {
  const b64 = process.env.LICENSE_PRIVATE_KEY;
  if (!b64) throw new Error("LICENSE_PRIVATE_KEY is not configured");
  return crypto.createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signToken(payload: Record<string, unknown>): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.sign(null, Buffer.from(body, "utf8"), privateKey());
  return `${body}.${b64url(sig)}`;
}

export function activationToken(machineId: string, label: string, key?: string): string {
  return signToken({ machineId, label, key, issuedAt: new Date().toISOString(), v: 1 });
}

export function trialToken(machineId: string, days: number): { token: string; start: string; end: string } {
  const start = new Date();
  const end = new Date(start.getTime() + days * 86400000);
  return {
    token: signToken({ kind: "trial", machineId, trialStart: start.toISOString(), trialEnd: end.toISOString(), v: 1 }),
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function randomHumanKey(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = crypto.randomBytes(9);
  const groups = [0, 1, 2].map((g) => [...buf.slice(g * 3, g * 3 + 3)].map((b) => chars[b % chars.length]).join(""));
  return `DILI-${groups.join("-")}`;
}

/// Crockford 4×5 activation keys (no I/L/O/U): "A7K2M-9QX4T-…".
/// New mints use this; old DILI- keys keep verifying (signature-based).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateActivationKey(): string {
  const buf = crypto.randomBytes(20);
  let s = "";
  for (let i = 0; i < 20; i++) s += CROCKFORD[buf[i] % 32];
  return [0, 1, 2, 3].map((g) => s.slice(g * 5, g * 5 + 5)).join("-");
}

export function normalizeActivationKey(key: string): string {
  return String(key || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/// Crockford forgiveness: the alphabet has no I/L/O, so a typed O/I/L can only
/// mean 0/1/1 (the UI font makes 0 and O look identical). Applied to both sides.
function canonicalKey(key: string): string {
  return normalizeActivationKey(key).replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function activationKeysEqual(a: string, b: string): boolean {
  const na = canonicalKey(a);
  const nb = canonicalKey(b);
  const ba = Buffer.from(na, "utf8");
  const bb = Buffer.from(nb, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/// Algerian mobile numbers only (trial gate): 05/06/07 + 8 digits.
export function validDzPhone(phone: string): boolean {
  return /^0[567]\d{8}$/.test(String(phone || "").trim());
}

export function licenseConfigured(): boolean {
  return !!process.env.LICENSE_PRIVATE_KEY;
}
