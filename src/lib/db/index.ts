import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Dual-backend Prisma client (Jafraa pattern).
//   DISTRIBUILI_DB=server (default) -> PostgreSQL
//   DISTRIBUILI_DB=local            -> SQLite file via @prisma/adapter-libsql

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
const isLocal = process.env.DISTRIBUILI_DB === "local";

function createServerClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    // Shop hardware can be slow; don't let interactive transactions expire
    // mid-flow (purchase/sale/transfer apply many sequential writes).
    transactionOptions: { timeout: 30000, maxWait: 10000 },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function createLocalClient(): PrismaClient {
  // The libSQL adapter is a normal require so Next traces it into the standalone
  // build (externalized via serverExternalPackages, never bundled). The generated
  // SQLite client lives at a custom path resolved at runtime; it is pulled into
  // standalone via outputFileTracingIncludes. Its types are structurally
  // compatible with the Postgres client (enums are plain strings either way),
  // so we cast it and every caller keeps importing `prisma` unchanged.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaLibSql } = require("@prisma/adapter-libsql");
  const nodeRequire = eval("require") as NodeRequire;
  const { resolve } = require("node:path") as typeof import("node:path");
  const clientPath =
    process.env.DISTRIBUILI_SQLITE_CLIENT ??
    resolve(process.cwd(), "src/generated/prisma-sqlite");
  const { PrismaClient: PrismaClientSqlite } = nodeRequire(clientPath);

  const url = process.env.DISTRIBUILI_SQLITE_URL ?? "file:./local.db";
  const encryptionKey = process.env.DISTRIBUILI_SQLITE_ENC_KEY || undefined;
  const adapter = new PrismaLibSql(encryptionKey ? { url, encryptionKey } : { url });
  const base = new PrismaClientSqlite({
    adapter,
    transactionOptions: { timeout: 30000, maxWait: 10000 },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return base as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? (isLocal ? createLocalClient() : createServerClient());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
