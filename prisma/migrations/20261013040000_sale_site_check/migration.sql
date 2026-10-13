-- Silent sale-site check on van tickets: phone GPS at sale time + distance
-- to the client's registered position (admin eyes only).

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "saleLat" DOUBLE PRECISION;
-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "saleLng" DOUBLE PRECISION;
-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "saleDistM" DOUBLE PRECISION;
