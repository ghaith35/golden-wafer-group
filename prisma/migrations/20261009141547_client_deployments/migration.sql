-- CreateTable
CREATE TABLE "client_deployments" (
    "id" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "domainOverride" TEXT,
    "overrideActive" BOOLEAN NOT NULL DEFAULT false,
    "tunnelSlotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_deployments_client_key" ON "client_deployments"("client");

-- AddForeignKey
ALTER TABLE "client_deployments" ADD CONSTRAINT "client_deployments_tunnelSlotId_fkey" FOREIGN KEY ("tunnelSlotId") REFERENCES "tunnel_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
