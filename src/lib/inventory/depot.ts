import { prisma } from "@/lib/db";

const NAMES: Record<string, string> = { ar: "المستودع الرئيسي", fr: "Dépôt principal", en: "Main depot" };

export function mainDepotName(locale?: string | null): string {
  return NAMES[locale ?? "ar"] ?? NAMES.ar;
}

/// Every company must own a main depot: stock entries, van loading and
/// commandes all start from it. Fresh installs used to get one only after the
/// first purchase (loading a commande before that failed with no_depot), so
/// it is now created at onboarding and self-healed here for older installs.
export async function ensureMainDepot(companyId: string): Promise<void> {
  const existing = await prisma.store.findFirst({ where: { companyId, kind: "DEPOT" }, select: { id: true } });
  if (existing) return;
  const settings = await prisma.companySettings.findUnique({ where: { companyId }, select: { defaultLocale: true } });
  await prisma.store.create({ data: { companyId, name: mainDepotName(settings?.defaultLocale), kind: "DEPOT" } });
}
