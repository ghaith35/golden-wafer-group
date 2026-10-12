// Test dataset for client demos (run against the LOCAL desktop DB):
//   70 clients (with secteurs) + 16 products (achat/vente/gros/super-gros)
//   + purchases of 1000/base each + 2 tournées/day/van × 5 stops.
// Usage:
//   DISTRIBUILI_DB=local DISTRIBUILI_SQLITE_URL='<file:...>' \
//     DISTRIBUILI_SQLITE_CLIENT='<abs path to src/generated/prisma-sqlite>' \
//     npx tsx scripts/seed-test-data.ts
// Safe to re-run: skips rows that already exist (by name/code).
import { prisma } from "@/lib/db";
import { createPurchase } from "@/lib/purchases/service";

const CID = "cmuyikyds0000p2e7cnfq048a"; // saldkf (local test company)

/// [name, cost(achat), detail(vente), gros, superGros]
const PRODUCTS: Array<[string, number, number, number, number]> = [
  ["سكر 1كغ", 95, 110, 104, 99],
  ["زيت 5ل", 890, 980, 940, 910],
  ["دقيق 10كغ", 750, 830, 795, 770],
  ["أرز 1كغ", 140, 160, 152, 146],
  ["معكرونة 500غ", 65, 78, 73, 69],
  ["طماطم مصبرة", 120, 140, 133, 127],
  ["قهوة 250غ", 320, 370, 350, 335],
  ["شاي 100غ", 180, 210, 200, 190],
  ["ملح 1كغ", 35, 45, 41, 38],
  ["عدس 1كغ", 160, 185, 176, 168],
  ["حمص 1كغ", 190, 220, 209, 199],
  ["فاصولياء 1كغ", 170, 195, 186, 178],
  ["حليب بودرة 500غ", 420, 480, 458, 440],
  ["سمن 1كغ", 550, 620, 592, 568],
  ["صابون طرف", 55, 70, 65, 60],
  ["جافل 1ل", 75, 90, 85, 80],
];

const SHOPS = ["محل", "بقالة", "سوبيرات", "حنوت", "متجر"];
const NAMES = ["النور", "السلام", "البركة", "الأمانة", "الفتح", "الياسمين", "الزيتون", "الواحة", "المدينة", "الخير", "الرحمة", "الإخلاص", "التقوى", "الصفا"];

/// [secteurName, wilayaCode]
const SECTEURS: Array<[string, number]> = [
  ["باب الزوار", 16], ["الدار البيضاء", 16], ["برج الكيفان", 16],
  ["وهران الشرق", 31], ["وهران الغرب", 31],
  ["سطيف Centre", 19], ["العلمة", 19],
];

async function main() {
  const company = await prisma.company.findUnique({ where: { id: CID } });
  if (!company) throw new Error(`company ${CID} not found`);

  // ── Units / category ──
  let pcs = await prisma.unit.findFirst({ where: { companyId: CID, name: "قطعة" } });
  if (!pcs) pcs = await prisma.unit.create({ data: { companyId: CID, name: "قطعة", symbol: "pcs" } });
  let cat = await prisma.productCategory.findFirst({ where: { companyId: CID, name: "مواد غذائية" } });
  if (!cat) cat = await prisma.productCategory.create({ data: { companyId: CID, name: "مواد غذائية" } });

  // ── Tiers: gros + super gros exist; add détail ──
  const tiers = await prisma.priceTier.findMany({ where: { companyId: CID } });
  const byName = new Map(tiers.map((t) => [t.name, t]));
  if (!byName.has("détail")) {
    byName.set("détail", await prisma.priceTier.create({ data: { companyId: CID, name: "détail", sortOrder: 0 } }));
  }
  const gros = byName.get("gros")!;
  const superGros = byName.get("super gros")!;

  // ── Products (16) with tier prices ──
  const prodIds: string[] = [];
  for (const [name, cost, detail, g, sg] of PRODUCTS) {
    let p = await prisma.product.findFirst({ where: { companyId: CID, name } });
    if (!p) {
      p = await prisma.product.create({
        data: {
          companyId: CID, categoryId: cat.id, name,
          baseUnitId: pcs.id, saleUnitId: pcs.id, purchaseUnitId: pcs.id,
          costPrice: cost, salePrice: detail, stockQty: 0,
        },
      });
    }
    for (const [tierId, price] of [[gros.id, g], [superGros.id, sg]] as const) {
      await prisma.productTierPrice.upsert({
        where: { productId_tierId: { productId: p.id, tierId } },
        update: { price },
        create: { productId: p.id, tierId, price },
      });
    }
    prodIds.push(p.id);
  }
  console.log(`✓ ${prodIds.length} products (achat/vente/gros/super-gros)`);

  // ── Supplier + purchases (1000 of each product) ──
  let sup = await prisma.supplier.findFirst({ where: { companyId: CID, name: "المورد الرئيسي" } });
  if (!sup) sup = await prisma.supplier.create({ data: { companyId: CID, name: "المورد الرئيسي", phone: "0550000000" } });
  const existingInv = await prisma.purchaseInvoice.count({ where: { companyId: CID } });
  if (existingInv === 0) {
    const prods = await prisma.product.findMany({ where: { id: { in: prodIds } } });
    const costOf = new Map(PRODUCTS.map(([n, c]) => [n, c]));
    const half = Math.ceil(prods.length / 2);
    for (const chunk of [prods.slice(0, half), prods.slice(half)]) {
      const lines = [];
      for (const p of chunk) {
        const gp = await prisma.productTierPrice.findUnique({ where: { productId_tierId: { productId: p.id, tierId: gros.id } } });
        const sp = await prisma.productTierPrice.findUnique({ where: { productId_tierId: { productId: p.id, tierId: superGros.id } } });
        lines.push({
          productId: p.id,
          qty: 1000,
          unitPrice: costOf.get(p.name) ?? Number(p.costPrice),
          salePrice: Number(p.salePrice),
          tierPrices: [
            { tierId: gros.id, price: Number(gp?.price ?? 0) },
            { tierId: superGros.id, price: Number(sp?.price ?? 0) },
          ],
        });
      }
      await createPurchase(CID, { supplierId: sup.id, lines } as never);
    }
    console.log(`✓ purchases: 1000/base of each product (2 invoices)`);
  } else {
    console.log(`✓ purchases skipped (${existingInv} invoices already)`);
  }

  // ── Secteurs (7) ──
  const secIds: string[] = [];
  for (const [name, wilayaCode] of SECTEURS) {
    let s = await prisma.secteur.findFirst({ where: { companyId: CID, wilayaCode, name } });
    if (!s) s = await prisma.secteur.create({ data: { companyId: CID, wilayaCode, name } });
    secIds.push(s.id);
  }
  console.log(`✓ ${secIds.length} secteurs`);

  // ── 70 clients, 10 per secteur, tier=gros ──
  const existingCli = await prisma.customer.count({ where: { companyId: CID } });
  if (existingCli === 0) {
    let n = 0;
    for (let i = 0; i < 70; i++) {
      n += 1;
      const secIdx = Math.floor(i / 10);
      const sec = await prisma.secteur.findUnique({ where: { id: secIds[secIdx] } });
      await prisma.customer.create({
        data: {
          companyId: CID,
          code: `CLT-${String(n).padStart(4, "0")}`,
          name: `${SHOPS[i % SHOPS.length]} ${NAMES[(i * 7) % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
          phone: `05${String(50000000 + i * 137).slice(0, 8)}`,
          wilayaCode: sec!.wilayaCode,
          secteurId: sec!.id,
          tierId: gros.id,
          balance: 0,
        },
      });
    }
    console.log(`✓ 70 clients (10/secteur, tier=gros)`);
  } else {
    console.log(`✓ clients skipped (${existingCli} already)`);
  }

  // ── Tournées: every VAN × 2/day × 5 stops, next 7 days ──
  const existingTours = await prisma.tournee.count({ where: { companyId: CID } });
  if (existingTours > 0) {
    console.log(`✓ tournées skipped (${existingTours} already)`);
    return;
  }
  const vans = await prisma.store.findMany({ where: { companyId: CID, kind: "VAN", isActive: true }, orderBy: { name: "asc" } });
  const clients = await prisma.customer.findMany({ where: { companyId: CID }, orderBy: { code: "asc" }, select: { id: true, secteurId: true } });
  let made = 0;
  for (const van of vans) {
    for (let d = 0; d < 7; d++) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + d);
      for (let t = 0; t < 2; t++) {
        // Spread stops across secteurs: tournée t covers secteurs t, t+2, … (5 stops).
        const pool = clients.filter((_, i) => i % 2 === t);
        const pick = pool.slice((d * 5) % Math.max(1, pool.length), (d * 5) % Math.max(1, pool.length) + 5);
        const stops = (pick.length ? pick : pool.slice(0, 5)).slice(0, 5);
        if (!stops.length) continue;
        const existing = await prisma.tournee.findFirst({ where: { companyId: CID, locationId: van.id, date } });
        void existing;
        const tour = await prisma.tournee.create({
          data: {
            companyId: CID, date, locationId: van.id,
            secteurId: stops[0].secteurId,
            status: "OPEN",
            notes: t === 0 ? "صباحا" : "مساء",
          },
        });
        for (let s = 0; s < stops.length; s++) {
          await prisma.tourneeStop.create({
            data: { tourneeId: tour.id, clientId: stops[s].id, position: s },
          }).catch(() => {});
        }
        made += 1;
      }
    }
  }
  console.log(`✓ ${made} tournées (${vans.length} van(s) × 2/day × 5 stops × 7 days)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error("SEED FAILED:", e); await prisma.$disconnect(); process.exit(1); });
