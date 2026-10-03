-- CreateEnum
CREATE TYPE "DailyCloseStatus" AS ENUM ('DECLARED', 'CLOSED');

-- AlterTable
ALTER TABLE "tournees" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "versements" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "tourneeId" TEXT;

-- CreateTable
CREATE TABLE "daily_closes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "vanId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "expected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "collected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "clientPayments" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "returnsCash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declared" DECIMAL(14,2),
    "declaredById" TEXT,
    "declaredAt" TIMESTAMP(3),
    "remitted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "DailyCloseStatus" NOT NULL DEFAULT 'DECLARED',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "daily_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_closes_companyId_date_idx" ON "daily_closes"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closes_companyId_vanId_date_key" ON "daily_closes"("companyId", "vanId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "stores_companyId_userId_key" ON "stores"("companyId", "userId");

-- CreateIndex
CREATE INDEX "versements_companyId_locationId_date_idx" ON "versements"("companyId", "locationId", "date");

-- AddForeignKey
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

