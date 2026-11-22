-- AlterTable
ALTER TABLE "stores" ADD COLUMN "qrSellRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stores" ADD COLUMN "qrOrderRequired" BOOLEAN NOT NULL DEFAULT true;

-- Selling keeps the company's previous "Strict QR" value; orders always needed a scan.
UPDATE "stores" SET "qrSellRequired" = false
WHERE "companyId" IN (SELECT "companyId" FROM "company_settings" WHERE "qrStrictMode" = false);
