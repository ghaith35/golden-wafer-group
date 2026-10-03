-- AlterTable
ALTER TABLE "products" ADD COLUMN     "purchaseUnitId" TEXT,
ADD COLUMN     "saleUnitId" TEXT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_saleUnitId_fkey" FOREIGN KEY ("saleUnitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_purchaseUnitId_fkey" FOREIGN KEY ("purchaseUnitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
