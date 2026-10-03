import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type PortalPayload = { clientId: string; companyId: string };

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export async function signPortalToken(payload: PortalPayload): Promise<string> {
  return new SignJWT({ ...payload, _type: "portal" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function getPortalSession(): Promise<PortalPayload | null> {
  const store = await cookies();
  const token = store.get("portal_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if ((payload as Record<string, unknown>)._type !== "portal") return null;
    return { clientId: String(payload.clientId), companyId: String(payload.companyId) };
  } catch {
    return null;
  }
}

export function portalCookieSecure(): boolean {
  if (process.env.COOKIE_SECURE != null) return process.env.COOKIE_SECURE === "true";
  return process.env.NODE_ENV === "production";
}
