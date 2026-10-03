import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type TransactionClient = Prisma.TransactionClient;

/// Auto-incrementing document numbers per (company, type, year).
/// With `prefix`, the counter is global (year 0) and formats as PREFIX-0001.
export async function nextDocNumber(
  tx: TransactionClient,
  companyId: string,
  type: string,
  year: number,
  prefix?: string,
): Promise<string> {
  // Note: upsert can't target the compound unique when storeId is null
  // (Prisma forbids null in the where), so find-then-write inside the tx.
  const keyYear = prefix ? 0 : year;
  const existing = await tx.documentSequence.findFirst({ where: { companyId, storeId: null, type, year: keyYear } });
  let used: number;
  if (existing) {
    await tx.documentSequence.update({ where: { id: existing.id }, data: { nextNo: { increment: 1 } } });
    used = existing.nextNo;
  } else {
    await tx.documentSequence.create({ data: { companyId, storeId: null, type, year: keyYear, nextNo: 2 } });
    used = 1;
  }
  const padded = String(used).padStart(4, "0");
  return prefix ? `${prefix}-${padded}` : `${year}-${padded}`;
}

export async function ensureSeasonFor(companyId: string, date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return prisma.season.upsert({
    where: { companyId_year_month: { companyId, year, month } },
    update: {},
    create: { companyId, year, month, status: "open" },
  });
}
