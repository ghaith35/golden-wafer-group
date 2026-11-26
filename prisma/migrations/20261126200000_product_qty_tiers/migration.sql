-- CreateTable
CREATE TABLE "product_qty_tiers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL DEFAULT '',
    "minQty" DECIMAL(14,3) NOT NULL,
    "tierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_qty_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_qty_tiers_productId_idx" ON "product_qty_tiers"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_qty_tiers_productId_unitKey_minQty_key" ON "product_qty_tiers"("productId", "unitKey", "minQty");

-- AddForeignKey
ALTER TABLE "product_qty_tiers" ADD CONSTRAINT "product_qty_tiers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_qty_tiers" ADD CONSTRAINT "product_qty_tiers_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "price_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
