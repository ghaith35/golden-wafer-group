-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "activityType" TEXT,
ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gpsLat" DOUBLE PRECISION,
ADD COLUMN     "gpsLng" DOUBLE PRECISION,
ADD COLUMN     "portalSecretHash" TEXT,
ADD COLUMN     "secteurId" TEXT,
ADD COLUMN     "tierId" TEXT,
ADD COLUMN     "wilayaCode" INTEGER;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "code" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "secteurId" TEXT,
ADD COLUMN     "wilayaCode" INTEGER;

-- CreateIndex
CREATE INDEX "customers_companyId_secteurId_idx" ON "customers"("companyId", "secteurId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_code_key" ON "customers"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_phone_key" ON "customers"("companyId", "phone");

-- CreateIndex
CREATE INDEX "suppliers_companyId_secteurId_idx" ON "suppliers"("companyId", "secteurId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_companyId_code_key" ON "suppliers"("companyId", "code");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "price_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "wilayas"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

