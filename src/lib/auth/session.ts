import { cookies } from "next/headers";
import { verifyToken, ACCESS_MAX_AGE, REFRESH_MAX_AGE, type SessionPayload } from "./tokens";
import { prisma } from "@/lib/db";

export { ACCESS_MAX_AGE, REFRESH_MAX_AGE };
export type { SessionPayload };
export { signAccessToken, signRefreshToken } from "./tokens";

export async function getSession(): Promise<(SessionPayload & { userId: string }) | null> {
  const store = await cookies();
  const access = store.get("access_token")?.value;
  const refresh = store.get("refresh_token")?.value;
  if (!access && !refresh) return null;
  try {
    // Never die: if the access cookie is missing/expired, the long-lived
    // refresh cookie keeps THIS request authenticated (the proxy re-mints the
    // access cookie for the next one). Only logout / cleared cookies end a session.
    let payload: Awaited<ReturnType<typeof verifyToken>> | null = null;
    if (access) payload = await verifyToken(access).catch(() => null);
    if (!payload && refresh) {
      const r = await verifyToken(refresh).catch(() => null);
      if (r && r._type === "refresh") payload = r;
    }
    if (!payload) return null;
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
