-- CreateEnum
CREATE TYPE "SaleKind" AS ENUM ('ORDER', 'DELIVERY', 'INVOICE', 'TICKET');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DELIVERED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('DEPOT', 'VAN', 'POS');

-- CreateEnum
CREATE TYPE "RefundType" AS ENUM ('CASH', 'DEBT_CREDIT');

-- CreateEnum
CREATE TYPE "TourneeStatus" AS ENUM ('OPEN', 'CLOSED');

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_wilayaCode_fkey";

-- DropForeignKey
ALTER TABLE "secteurs" DROP CONSTRAINT "secteurs_wilayaCode_fkey";

-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_wilayaCode_fkey";

-- DropTable
DROP TABLE "wilayas";

-- CreateTable
CREATE TABLE "Wilaya" (
    "code" INTEGER NOT NULL,
    "nameFr" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,

    CONSTRAINT "Wilaya_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "kind" "SaleKind" NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" "SaleChannel" NOT NULL DEFAULT 'DEPOT',
    "number" TEXT NOT NULL,
    "clientId" TEXT,
    "locationId" TEXT,
    "tierId" TEXT,
    "tourneeId" TEXT,
    "sourceId" TEXT,
    "remise" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "offList" BOOLEAN NOT NULL DEFAULT false,
    "qrScanned" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "baseQty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "remise" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_returns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seasonId" TEXT,
    "clientId" TEXT NOT NULL,
    "saleId" TEXT,
    "locationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "refundType" "RefundType" NOT NULL,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "baseQty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "client_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,
    "secteurId" TEXT,
    "status" "TourneeStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournee_stops" (
    "id" TEXT NOT NULL,
    "tourneeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "visited" BOOLEAN NOT NULL DEFAULT false,
    "sold" BOOLEAN NOT NULL DEFAULT false,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "tournee_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_companyId_clientId_idx" ON "sales"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "sales_companyId_status_idx" ON "sales"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_companyId_kind_number_key" ON "sales"("companyId", "kind", "number");

-- CreateIndex
CREATE INDEX "sale_lines_saleId_idx" ON "sale_lines"("saleId");

-- CreateIndex
CREATE INDEX "client_returns_companyId_clientId_idx" ON "client_returns"("companyId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_returns_companyId_number_key" ON "client_returns"("companyId", "number");

-- CreateIndex
CREATE INDEX "client_return_lines_returnId_idx" ON "client_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "tournees_companyId_date_idx" ON "tournees"("companyId", "date");

-- CreateIndex
CREATE INDEX "tournees_companyId_locationId_idx" ON "tournees"("companyId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "tournee_stops_tourneeId_clientId_key" ON "tournee_stops"("tourneeId", "clientId");

-- AddForeignKey
ALTER TABLE "secteurs" ADD CONSTRAINT "secteurs_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "price_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tourneeId_fkey" FOREIGN KEY ("tourneeId") REFERENCES "tournees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_returns" ADD CONSTRAINT "client_returns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_returns" ADD CONSTRAINT "client_returns_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_returns" ADD CONSTRAINT "client_returns_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_returns" ADD CONSTRAINT "client_returns_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_return_lines" ADD CONSTRAINT "client_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "client_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_return_lines" ADD CONSTRAINT "client_return_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournees" ADD CONSTRAINT "tournees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournees" ADD CONSTRAINT "tournees_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournees" ADD CONSTRAINT "tournees_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournee_stops" ADD CONSTRAINT "tournee_stops_tourneeId_fkey" FOREIGN KEY ("tourneeId") REFERENCES "tournees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournee_stops" ADD CONSTRAINT "tournee_stops_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

