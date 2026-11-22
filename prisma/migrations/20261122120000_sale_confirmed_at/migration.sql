-- AlterTable
ALTER TABLE "sales" ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- Tickets that already exist were final before this feature: keep them confirmed.
UPDATE "sales" SET "confirmedAt" = "createdAt" WHERE "kind" = 'TICKET';
