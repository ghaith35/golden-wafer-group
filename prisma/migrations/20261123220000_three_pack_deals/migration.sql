-- AlterEnum (PostgreSQL 12+: each ADD VALUE is fine in a migration of its own statements)
ALTER TYPE "ThreePackMode" ADD VALUE 'PERCENT';
ALTER TYPE "ThreePackMode" ADD VALUE 'PRICE';

-- AlterTable
ALTER TABLE "three_pack_rules" ADD COLUMN     "percent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "three_pack_items" ADD COLUMN     "price" DECIMAL(14,2);
