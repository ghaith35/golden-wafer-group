import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

/// Vendor superadmin session: separate users table + separate cookie from
/// company users. Guards the /superadmin console and its APIs.

export const SUPER_ADMIN_COOKIE = "dili_superadmin";

function secret(): Uint8Array {
  const s = process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export type SuperAdminPayload = { adminId: string; username: string; _type: "superadmin" };

export async function signSuperAdminToken(payload: Omit<SuperAdminPayload, "_type">): Promise<string> {
  return new SignJWT({ ...payload, _type: "superadmin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("4h")
    .sign(secret());
}

export async function verifySuperAdminToken(token: string): Promise<SuperAdminPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if ((payload as Record<string, unknown>)._type !== "superadmin") return null;
    return payload as unknown as SuperAdminPayload;
  } catch {
    return null;
  }
}

export async function getSuperAdminSession(): Promise<SuperAdminPayload | null> {
  try {
    const token = (await cookies()).get(SUPER_ADMIN_COOKIE)?.value;
    if (!token) return null;
    const p = await verifySuperAdminToken(token);
    if (!p) return null;
    const admin = await prisma.superAdminUser.findUnique({ where: { id: p.adminId } });
    if (!admin || !admin.isActive) return null;
    return p;
  } catch {
    return null;
  }
}

export async function requireSuperAdmin(): Promise<{ ok: true; admin: SuperAdminPayload } | { ok: false; response: Response }> {
  const { NextResponse } = await import("next/server");
  const admin = await getSuperAdminSession();
  if (!admin) return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  return { ok: true, admin };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export async function audit(adminId: string, action: string, targetType?: string, targetId?: string, meta?: Record<string, unknown>, ip?: string): Promise<void> {
  try {
    await prisma.superAdminAudit.create({
      data: { adminId, action, targetType: targetType ?? null, targetId: targetId ?? null, meta: (meta ?? {}) as never, ip: ip ?? null },
    });
  } catch {
    /* audit must never break the action */
  }
}

export function clientIp(req: Request): string | null {
  // Production runs behind a proxy/CDN that sets X-Forwarded-For (or
  // X-Real-IP). Direct connections carry no reliable IP — IP blocks only
  // apply where a proxy header exists (i.e. every real deployment).
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd ? fwd.split(",")[0].trim() : "";
  if (first) return first;
  const real = req.headers.get("x-real-ip");
  return real ? real.trim() || null : null;
}
