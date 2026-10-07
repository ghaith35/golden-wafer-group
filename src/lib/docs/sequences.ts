import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type TransactionClient = Prisma.TransactionClient;

/// Auto-incrementing document numbers per (company, type, year).
/// With `prefix`, the counter is global (year 0) and formats as PREFIX-0001.
///
/// Concurrency-safe: Postgres takes a transaction-scoped advisory lock on the
/// sequence key before the read-modify-write, so two vans syncing at the same
/// instant can never mint the same number. Local SQLite (single-process
/// desktop) uses an in-process mutex instead.

const isLocal = () => process.env.DISTRIBUILI_DB === "local";

// In-process mutex for local/SQLite mode (libSQL serializes writes; this
// serializes the JS read-modify-write too).
let seqLock: Promise<unknown> = Promise.resolve();
async function withSeqLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = seqLock;
  let release!: () => void;
  seqLock = new Promise((resolve) => (release = resolve as () => void));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function allocate(
  tx: TransactionClient,
  companyId: string,
  type: string,
  keyYear: number,
  year: number,
  prefix?: string,
): Promise<string> {
  // Note: upsert can't target the compound unique when storeId is null
  // (Prisma forbids null in the where), so find-then-write under the lock.
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

export async function nextDocNumber(
  tx: TransactionClient,
  companyId: string,
  type: string,
  year: number,
  prefix?: string,
): Promise<string> {
  const keyYear = prefix ? 0 : year;
  if (isLocal()) {
    return withSeqLock(() => allocate(tx, companyId, type, keyYear, year, prefix));
  }
  // hashtext(text) → int4, implicitly widened to bigint for the lock.
  // `... IS NULL` turns the void return into a boolean Prisma can deserialize.
  const lockKey = `${companyId}|${type}|${keyYear}`;
  await tx.$queryRaw`SELECT (pg_advisory_xact_lock(hashtext(${lockKey})) IS NULL) AS locked`;
  return allocate(tx, companyId, type, keyYear, year, prefix);
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
