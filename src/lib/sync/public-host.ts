import { prisma } from "@/lib/db";
import { isPublicHttpsOrigin, normalizeDomain } from "@/lib/sync/urls";

/// Default link domain for this build (editable in Settings → Devices).
export const DEFAULT_PUBLIC_HOSTNAME = "https://dist-client1.khiatadz.com";

/// Explicit per-install override (Electron public-hostname.txt / env /
/// per-client compose). Empty when not set — then the DB value wins.
export function explicitHostnameOrigin(): string {
  const raw = (process.env.DISTRIBUILI_PUBLIC_HOSTNAME || "").trim();
  if (!raw) return "";
  const origin = normalizeDomain(raw).replace(/\/+$/, "");
  return isPublicHttpsOrigin(origin) ? origin : "";
}

/// Per-install public hostname (dynamic).
/// Wherever the EXE/DMG runs, that machine directly serves its own subdomain
/// via an outbound connector on the PC.
/// Source: DISTRIBUILI_PUBLIC_HOSTNAME env (set by Electron from
/// <userData>/public-hostname.txt, or by per-client compose on a VPS).
/// Falls back to the baked-in client1 domain so the QR works with zero config.
export function publicHostnameOrigin(): string {
  const explicit = explicitHostnameOrigin();
  const raw = explicit || DEFAULT_PUBLIC_HOSTNAME;
  const origin = normalizeDomain(raw).replace(/\/+$/, "");
  return isPublicHttpsOrigin(origin) ? origin : "";
}

/// Ensure CompanySettings.remoteDomain matches this install's hostname.
/// Called lazily (Devices page + devices API) so every install self-links
/// with zero config. Priority: explicit env/file override → existing DB value
/// (set in Settings → Devices) → baked-in client1 default.
/// This build always resolves to client1 unless overridden by env or settings.
export async function ensurePublicHostname(companyId: string): Promise<string> {
  const explicit = explicitHostnameOrigin();
  if (explicit) {
    const current = await prisma.companySettings.findUnique({
      where: { companyId },
      select: { remoteDomain: true },
    });
    if (current?.remoteDomain !== explicit) {
      await prisma.companySettings.upsert({
        where: { companyId },
        update: { remoteDomain: explicit },
        create: { companyId, remoteDomain: explicit },
      });
    }
    return explicit;
  }
  const current = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { remoteDomain: true },
  });
  const existing = normalizeDomain(current?.remoteDomain ?? "").replace(/\/+$/, "");
  if (existing && isPublicHttpsOrigin(existing)) return existing;
  await prisma.companySettings.upsert({
    where: { companyId },
    update: { remoteDomain: DEFAULT_PUBLIC_HOSTNAME },
    create: { companyId, remoteDomain: DEFAULT_PUBLIC_HOSTNAME },
  });
  return DEFAULT_PUBLIC_HOSTNAME;
}
