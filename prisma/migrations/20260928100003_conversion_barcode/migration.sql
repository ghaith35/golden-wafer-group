-- AlterTable
ALTER TABLE "product_unit_conversions" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE INDEX "product_unit_conversions_barcode_idx" ON "product_unit_conversions"("barcode");
