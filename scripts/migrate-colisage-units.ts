import "dotenv/config";
import { prisma } from "@/lib/db";

/// One-time colisage migration: every product that comes in colisage is
/// restocked in CARTONS. Live balances convert (history lines untouched).
///   base → كرتون, new conversion oldBase = 1/N carton,
///   prices ×N, stock/min ÷N, batches qty ÷N + unitCost ×N (value preserved).

// pieces per carton, by product reference (explicit — no guessing).
const N_BY_REF: Record<string, number> = {
  "CC-1L": 6,
  "FA-1L": 6,
  "EM-15": 6,
  "HT-5L": 4,
  "SC-1K": 20,
  "CF-250": 24,
  "LU-1L": 12,
  "PS-500": 24,
  "LP-2K": 6,
  "SM-400": 48,
  "CT-100": 36,
  "BS-24": 24,
  ts005: 40,
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  for (const c of companies) {
    const carton = await prisma.unit.findFirst({ where: { companyId: c.id, name: "كرتون" } });
    const piece = await prisma.unit.findFirst({ where: { companyId: c.id, name: "قطعة" } });
    if (!carton) {
      console.log(`[${c.name}] no كرتون unit — skipped`);
      continue;
    }
    const products = await prisma.product.findMany({
      where: { companyId: c.id },
      include: { baseUnit: true, conversions: true },
    });
    for (const p of products) {
      const n = N_BY_REF[p.reference ?? ""];
      if (!n) {
        console.log(`[${c.name}] SKIP ${p.reference} ${p.name} (no colisage rule)`);
        continue;
      }
      const pieceUnitId = p.baseUnitId === carton.id ? (piece?.id ?? null) : p.baseUnitId;
      if (!pieceUnitId) {
        console.log(`[${c.name}] SKIP ${p.reference} (no piece unit)`);
        continue;
      }
      const alreadyCarton = p.baseUnitId === carton.id;
      await prisma.$transaction(async (tx) => {
        // 1. conversion: 1 piece = 1/N carton
        await tx.productUnitConversion.upsert({
          where: { productId_unitId: { productId: p.id, unitId: pieceUnitId } },
          update: { factor: r3(1 / n) },
          create: { productId: p.id, unitId: pieceUnitId, factor: r3(1 / n) },
        });
        if (alreadyCarton) {
          await tx.product.update({
            where: { id: p.id },
            data: { saleUnitId: carton.id, purchaseUnitId: carton.id },
          });
          console.log(`[${c.name}] ${p.reference}: already carton, piece 1/${n} linked`);
          return;
        }
        // 2. live balances ÷N, prices ×N
        const batches = await tx.stockBatch.findMany({ where: { productId: p.id } });
        for (const b of batches) {
          await tx.stockBatch.update({
            where: { id: b.id },
            data: { qty: r3(Number(b.qty) / n), initialQty: r3(Number(b.initialQty) / n), unitCost: r2(Number(b.unitCost) * n) },
          });
        }
        const tiers = await tx.productTierPrice.findMany({ where: { productId: p.id } });
        for (const t of tiers) {
          await tx.productTierPrice.update({ where: { id: t.id }, data: { price: r2(Number(t.price) * n) } });
        }
        await tx.product.update({
          where: { id: p.id },
          data: {
            baseUnitId: carton.id,
            saleUnitId: carton.id,
            purchaseUnitId: carton.id,
            salePrice: r2(Number(p.salePrice) * n),
            costPrice: r2(Number(p.costPrice) * n),
            stockQty: r3(Number(p.stockQty) / n),
            minStock: r3(Number(p.minStock) / n),
          },
        });
      });
      console.log(`[${c.name}] ${p.reference}: → carton ×${n} (history untouched)`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
