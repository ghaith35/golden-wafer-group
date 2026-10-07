-- Exactly-once offline sync: idempotency keys on created documents.
-- A sync opId is unique per company on every entity it can create, so a
-- retried / concurrently-applied offline op can never duplicate a document.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "opId" TEXT;
ALTER TABLE "customers" ADD COLUMN     "opId" TEXT;
ALTER TABLE "transfers" ADD COLUMN     "opId" TEXT;
ALTER TABLE "client_returns" ADD COLUMN     "opId" TEXT;
ALTER TABLE "versements" ADD COLUMN     "opId" TEXT;
ALTER TABLE "sync_ops" ADD COLUMN     "resultId" TEXT;
ALTER TABLE "sync_ops" ADD COLUMN     "occurredAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "sales_companyId_opId_key" ON "sales"("companyId", "opId");
CREATE UNIQUE INDEX "customers_companyId_opId_key" ON "customers"("companyId", "opId");
CREATE UNIQUE INDEX "transfers_companyId_opId_key" ON "transfers"("companyId", "opId");
CREATE UNIQUE INDEX "client_returns_companyId_opId_key" ON "client_returns"("companyId", "opId");
CREATE UNIQUE INDEX "versements_companyId_opId_key" ON "versements"("companyId", "opId");
