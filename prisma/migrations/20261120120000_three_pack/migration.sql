-- CreateEnum
CREATE TYPE "ThreePackMode" AS ENUM ('SINGLE', 'PACK');

-- CreateEnum
CREATE TYPE "ThreePackRole" AS ENUM ('BUY', 'GIVE');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "threePackEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sale_lines" ADD COLUMN     "bonusRuleId" TEXT,
ADD COLUMN     "isBonus" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "three_pack_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "ThreePackMode" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "three_pack_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "three_pack_items" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "role" "ThreePackRole" NOT NULL,
    "productId" TEXT NOT NULL,
    "colis" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "three_pack_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "three_pack_rules_companyId_idx" ON "three_pack_rules"("companyId");

-- CreateIndex
CREATE INDEX "three_pack_items_ruleId_idx" ON "three_pack_items"("ruleId");

-- CreateIndex
CREATE INDEX "three_pack_items_productId_idx" ON "three_pack_items"("productId");

-- AddForeignKey
ALTER TABLE "three_pack_rules" ADD CONSTRAINT "three_pack_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_pack_items" ADD CONSTRAINT "three_pack_items_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "three_pack_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_pack_items" ADD CONSTRAINT "three_pack_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
