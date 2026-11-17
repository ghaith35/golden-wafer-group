ALTER TABLE "customers" ADD COLUMN "legacyQr" TEXT;
CREATE UNIQUE INDEX "customers_companyId_legacyQr_key" ON "customers"("companyId", "legacyQr");
