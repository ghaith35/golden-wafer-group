-- AlterTable
ALTER TABLE "license_keys" ADD COLUMN     "consumedByMachineId" TEXT;

-- AlterTable
ALTER TABLE "machines" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activationKey" TEXT,
ADD COLUMN     "activationType" TEXT NOT NULL DEFAULT 'machine',
ADD COLUMN     "city" TEXT,
ADD COLUMN     "consumedByMachineId" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "deviceSpecs" JSONB,
ADD COLUMN     "lastIp" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "token" TEXT,
ADD COLUMN     "trialEnd" TIMESTAMP(3),
ADD COLUMN     "trialIp" TEXT,
ADD COLUMN     "trialStart" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "super_admin_users" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "super_admin_audits" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_subscriptions" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'trial',
    "expiresAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_ips" (
    "ip" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_ips_pkey" PRIMARY KEY ("ip")
);

-- CreateIndex
CREATE INDEX "super_admin_audits_adminId_createdAt_idx" ON "super_admin_audits"("adminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "machine_subscriptions_machineId_key" ON "machine_subscriptions"("machineId");

-- CreateIndex
CREATE INDEX "machines_status_createdAt_idx" ON "machines"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "super_admin_audits" ADD CONSTRAINT "super_admin_audits_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "super_admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_subscriptions" ADD CONSTRAINT "machine_subscriptions_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("machineId") ON DELETE CASCADE ON UPDATE CASCADE;

