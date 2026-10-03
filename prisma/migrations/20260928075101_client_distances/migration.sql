-- CreateTable
CREATE TABLE "client_distances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "distanceM" DOUBLE PRECISION NOT NULL,
    "durationS" DOUBLE PRECISION NOT NULL,
    "atLat" DOUBLE PRECISION NOT NULL,
    "atLng" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'estimate',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_distances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_distances_companyId_userId_idx" ON "client_distances"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "client_distances_companyId_userId_clientId_key" ON "client_distances"("companyId", "userId", "clientId");

-- AddForeignKey
ALTER TABLE "client_distances" ADD CONSTRAINT "client_distances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_distances" ADD CONSTRAINT "client_distances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_distances" ADD CONSTRAINT "client_distances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
