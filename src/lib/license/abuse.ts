import { prisma } from "@/lib/db";

/// Manual abuse control: blocked IPs can't register/trial (never breaks an
/// already-entitled install).
export async function isIpBlocked(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  const row = await prisma.blockedIp.findUnique({ where: { ip } }).catch(() => null);
  return !!row;
}

function sanitizeSpecs(specs: unknown): Record<string, string> | null {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs as Record<string, unknown>).slice(0, 16)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[String(k).slice(0, 40)] = String(v).slice(0, 160);
    }
  }
  return out;
}

export { sanitizeSpecs };
