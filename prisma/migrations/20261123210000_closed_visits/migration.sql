-- CreateTable
CREATE TABLE "closed_visits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT,
    "userId" TEXT,
    "opId" TEXT,
    "note" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "closed_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closed_visit_photos" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "closed_visit_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "closed_visits_companyId_occurredAt_idx" ON "closed_visits"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "closed_visits_customerId_idx" ON "closed_visits"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "closed_visits_companyId_opId_key" ON "closed_visits"("companyId", "opId");

-- CreateIndex
CREATE INDEX "closed_visit_photos_visitId_idx" ON "closed_visit_photos"("visitId");

-- AddForeignKey
ALTER TABLE "closed_visits" ADD CONSTRAINT "closed_visits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_visits" ADD CONSTRAINT "closed_visits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_visits" ADD CONSTRAINT "closed_visits_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_visits" ADD CONSTRAINT "closed_visits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_visit_photos" ADD CONSTRAINT "closed_visit_photos_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "closed_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

