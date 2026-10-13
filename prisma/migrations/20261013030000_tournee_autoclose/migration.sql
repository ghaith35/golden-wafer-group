-- Auto-close flag for journées never finished the same day (started but
-- unfinished when the day rolls over → system ends them, admin is flagged).

-- AlterTable
ALTER TABLE "tournees" ADD COLUMN     "autoClosed" BOOLEAN NOT NULL DEFAULT false;
