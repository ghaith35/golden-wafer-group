import { cookies } from "next/headers";
import { verifyToken, ACCESS_MAX_AGE, REFRESH_MAX_AGE, type SessionPayload } from "./tokens";
import { prisma } from "@/lib/db";

export { ACCESS_MAX_AGE, REFRESH_MAX_AGE };
export type { SessionPayload };
export { signAccessToken, signRefreshToken } from "./tokens";

export async function getSession(): Promise<(SessionPayload & { userId: string }) | null> {
  const store = await cookies();
  const token = store.get("access_token")?.value;
  if (!token) return null;
  try {
    const payload = await verifyToken(token);
    const companyId = String(payload.companyId);
    // Deep fix: a token can outlive its company (DB reset, company deleted).
    // Without this check every company-scoped query 500s on FK violations;
    // returning null degrades to a clean login redirect instead.
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) return null;
    return {
      userId: String(payload.sub),
      companyId,
      username: String(payload.username),
      role: String(payload.role),
      sub: String(payload.sub),
    };
  } catch {
    return null;
  }
}

export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE != null) return process.env.COOKIE_SECURE === "true";
  return process.env.NODE_ENV === "production";
}
