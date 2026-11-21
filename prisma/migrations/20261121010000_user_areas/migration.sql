-- CreateTable
CREATE TABLE "user_areas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wilayaCode" INTEGER NOT NULL,
    "secteurId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_areas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_areas_userId_idx" ON "user_areas"("userId");

-- AddForeignKey
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_wilayaCode_fkey" FOREIGN KEY ("wilayaCode") REFERENCES "Wilaya"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_secteurId_fkey" FOREIGN KEY ("secteurId") REFERENCES "secteurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
