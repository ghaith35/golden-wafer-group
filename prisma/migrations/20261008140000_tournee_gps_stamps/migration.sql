-- Journée tracking improvements: GPS stamps on départ/fin + company
-- work-start expectations for late/overtime flags.

-- AlterTable
ALTER TABLE "tournees" ADD COLUMN     "startedLat" DOUBLE PRECISION;
ALTER TABLE "tournees" ADD COLUMN     "startedLng" DOUBLE PRECISION;
ALTER TABLE "tournees" ADD COLUMN     "finishedLat" DOUBLE PRECISION;
ALTER TABLE "tournees" ADD COLUMN     "finishedLng" DOUBLE PRECISION;
ALTER TABLE "company_settings" ADD COLUMN     "workStartAt" TEXT;
ALTER TABLE "company_settings" ADD COLUMN     "maxDayHours" DOUBLE PRECISION DEFAULT 10;
