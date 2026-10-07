-- Vendor tunnel slots (one public hostname per client) + per-install
-- public domain used by the Devices setup QR.

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "remoteDomain" TEXT;

-- CreateTable
CREATE TABLE "tunnel_slots" (
    "id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tunnelId" TEXT,
    "token" TEXT,
    "clientMachineId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tunnel_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tunnel_slots_subdomain_key" ON "tunnel_slots"("subdomain");
