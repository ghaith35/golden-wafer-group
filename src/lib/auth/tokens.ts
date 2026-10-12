import { SignJWT, jwtVerify } from "jose";

/// Pure JWT helpers — no next/headers, safe to import in proxy/edge.
/// Access is long-lived and slides: the proxy renews it from the refresh
/// cookie whenever it is expired (or nearly), so active users never get
/// logged out. Idle past the refresh lifetime → login again.
export const ACCESS_MAX_AGE = 60 * 60 * 12; // 12h
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 365; // 365d
/// Renew the access token when less than this many seconds remain.
export const ACCESS_SLIDE_WINDOW = 60 * 60; // 1h

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export type SessionPayload = {
  sub: string;
  companyId: string;
  username: string;
  role: string;
};

export type RefreshClaims = SessionPayload & { _type: "refresh" };

export async function signAccessToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export async function signRefreshToken(payload: SessionPayload): Promise<string> {
  // Random jti (Web Crypto — edge-safe, unlike node:crypto): two logins in
  // the same second (double-tap on a slow line, two devices at once) must
  // NEVER mint the same token — the refresh_tokens table keys on the token
  // hash and a collision 500s a legit login.
  const jti =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new SignJWT({ ...payload, _type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime("365d")
    .sign(secret());
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, secret());
  return payload;
}
