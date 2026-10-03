import { prisma } from "@/lib/db";

/** Auto Year+Month periods (never manual, never deletable) — Jafraa pattern. */
export async function ensureCurrentSeason(companyId: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return prisma.season.upsert({
    where: { companyId_year_month: { companyId, year, month } },
    update: {},
    create: { companyId, year, month, status: "open" },
  });
}

export async function getSeason(companyId: string, year: number, month: number) {
  return prisma.season.findUnique({ where: { companyId_year_month: { companyId, year, month } } });
}

export async function listSeasons(companyId: string) {
  await ensureCurrentSeason(companyId);
  return prisma.season.findMany({
    where: { companyId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 24,
  });
}
