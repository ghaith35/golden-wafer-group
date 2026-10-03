-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "paid" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "versements" ADD COLUMN     "purchaseInvoiceId" TEXT;

-- AddForeignKey
ALTER TABLE "versements" ADD CONSTRAINT "versements_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
