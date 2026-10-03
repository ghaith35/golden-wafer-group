import "dotenv/config";
import { prisma } from "@/lib/db";

/// Whole-carton cleanup: carton-based products must hold whole cartons.
/// Rounds live depot batches to the nearest carton, minimums up.

async function main() {
  const products = await prisma.product.findMany({
    where: { baseUnit: { name: "كرتون" } },
    select: { id: true, reference: true, name: true, stockQty: true, minStock: true, companyId: true },
  });
  for (const p of products) {
    const whole = Math.round(Number(p.stockQty));
    const minWhole = Math.ceil(Number(p.minStock));
    if (whole === Number(p.stockQty) && minWhole === Number(p.minStock)) {
      console.log(`${p.reference}: already whole (${whole})`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const batches = await tx.stockBatch.findMany({
        where: { productId: p.id, transferId: null, qty: { gt: 0 } },
      });
      let assigned = 0;
      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        // Put all whole cartons in the first batch, zero the rest.
        const q = i === 0 ? whole : 0;
        if (i === 0) assigned = q;
        await tx.stockBatch.update({
          where: { id: b.id },
          data: { qty: q, initialQty: q },
        });
      }
      await tx.product.update({
        where: { id: p.id },
        data: { stockQty: whole, minStock: minWhole },
      });
      void assigned;
    });
    console.log(`${p.reference}: ${p.stockQty} → ${whole} cartons (min ${p.minStock} → ${minWhole})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
