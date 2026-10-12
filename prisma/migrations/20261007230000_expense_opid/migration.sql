-- Offline expense entry from the van phone: idempotency key like every other
-- synced document, so a retried offline expense can never duplicate.

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "opId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "expenses_companyId_opId_key" ON "expenses"("companyId", "opId");
