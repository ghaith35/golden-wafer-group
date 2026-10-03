import { prisma } from "@/lib/db";

export type LivVan = { id: string; name: string; matricule: string | null };

export async function getLivreurVan(companyId: string, userId: string): Promise<LivVan | null> {
  return prisma.store.findFirst({
    where: { companyId, kind: "VAN", isActive: true, userId },
    select: { id: true, name: true, matricule: true },
  });
}
