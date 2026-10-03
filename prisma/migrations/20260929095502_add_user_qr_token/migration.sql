-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordView" TEXT,
ADD COLUMN     "qrToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_qrToken_key" ON "users"("qrToken");

