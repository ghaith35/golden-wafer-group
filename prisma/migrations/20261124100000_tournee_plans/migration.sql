
-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "tourPlansMigratedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tournees" ADD COLUMN     "planId" TEXT,
ADD COLUMN     "slot" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tournee_plans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "secteurId" TEXT,
    "weekday" INTEGER NOT NULL,
    "intervalWeeks" INTEGER NOT NULL DEFAULT 1,
    "anchorKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "clientIds" TEXT,
    "skips" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournee_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournee_plans_companyId_isActive_idx" ON "tournee_plans"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "tournee_plans_locationId_weekday_idx" ON "tournee_plans"("locationId", "weekday");

-- CreateIndex
CREATE INDEX "tournees_locationId_date_idx" ON "tournees"("locationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "tournees_planId_date_key" ON "tournees"("planId", "date");

-- AddForeignKey
ALTER TABLE "tournees" ADD CONSTRAINT "tournees_planId_fkey" FOREIGN KEY ("planId") REFERENCES "tournee_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournee_plans" ADD CONSTRAINT "tournee_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournee_plans" ADD CONSTRAINT "tournee_plans_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournee_plans" ADD CONSTRAINT "tournee_plans_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

