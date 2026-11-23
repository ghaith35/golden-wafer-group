
-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "lastTrackState" TEXT;

-- CreateTable
CREATE TABLE "van_positions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "van_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "van_positions_vanId_recordedAt_idx" ON "van_positions"("vanId", "recordedAt");

-- CreateIndex
CREATE INDEX "van_positions_companyId_recordedAt_idx" ON "van_positions"("companyId", "recordedAt");

-- AddForeignKey
ALTER TABLE "van_positions" ADD CONSTRAINT "van_positions_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

