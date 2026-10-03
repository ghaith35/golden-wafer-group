import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const WILAYAS: Array<[number, string, string]> = [
  [1, "Adrar", "أدرار"], [2, "Chlef", "الشلف"], [3, "Laghouat", "الأغواط"],
  [4, "Oum El Bouaghi", "أم البواقي"], [5, "Batna", "باتنة"], [6, "Béjaïa", "بجاية"],
  [7, "Biskra", "بسكرة"], [8, "Béchar", "بشار"], [9, "Blida", "البليدة"],
  [10, "Bouira", "البويرة"], [11, "Tamanrasset", "تمنراست"], [12, "Tébessa", "تبسة"],
  [13, "Tlemcen", "تلمسان"], [14, "Tiaret", "تيارت"], [15, "Tizi Ouzou", "تيزي وزو"],
  [16, "Alger", "الجزائر"], [17, "Djelfa", "الجلفة"], [18, "Jijel", "جيجل"],
  [19, "Sétif", "سطيف"], [20, "Saïda", "سعيدة"], [21, "Skikda", "سكيكدة"],
  [22, "Sidi Bel Abbès", "سيدي بلعباس"], [23, "Annaba", "عنابة"], [24, "Guelma", "قالمة"],
  [25, "Constantine", "قسنطينة"], [26, "Médéa", "المدية"], [27, "Mostaganem", "مستغانم"],
  [28, "M'Sila", "المسيلة"], [29, "Mascara", "معسكر"], [30, "Ouargla", "ورقلة"],
  [31, "Oran", "وهران"], [32, "El Bayadh", "البيض"], [33, "Illizi", "إليزي"],
  [34, "Bordj Bou Arréridj", "برج بوعريريج"], [35, "Boumerdès", "بومرداس"],
  [36, "El Tarf", "الطارف"], [37, "Tindouf", "تندوف"], [38, "Tissemsilt", "تيسمسيلت"],
  [39, "El Oued", "الوادي"], [40, "Khenchela", "خنشلة"], [41, "Souk Ahras", "سوق أهراس"],
  [42, "Tipaza", "تيبازة"], [43, "Mila", "ميلة"], [44, "Aïn Defla", "عين الدفلى"],
  [45, "Naâma", "النعامة"], [46, "Aïn Témouchent", "عين تموشنت"], [47, "Ghardaïa", "غرداية"],
  [48, "Relizane", "غليزان"], [49, "Timimoun", "تيميمون"], [50, "Bordj Badji Mokhtar", "برج باجي مختار"],
  [51, "Ouled Djellal", "أولاد جلال"], [52, "Béni Abbès", "بني عباس"], [53, "In Salah", "عين صالح"],
  [54, "In Guezzam", "عين قزام"], [55, "Touggourt", "تقرت"], [56, "Djanet", "جانت"],
  [57, "El M'Ghair", "المغير"], [58, "El Meniaa", "المنيعة"],
  [59, "Aflou", "أفلو"], [60, "Barika", "بريكة"], [61, "El Kantara", "القنطرة"],
  [62, "Bir El Ater", "بير العاتر"], [63, "El Aricha", "العريشة"], [64, "Ksar Chellala", "قصر الشلالة"],
  [65, "Aïn Oussara", "عين وسارة"], [66, "Messaad", "مسعد"], [67, "Ksar El Boukhari", "قصر البخاري"],
  [68, "Bou Saâda", "بوسعادة"], [69, "El Abiodh Sidi Cheikh", "الأبيض سيدي الشيخ"],
];

async function main() {
  // ── Global reference: 69 wilayas (shared by all companies) ──
  for (const [code, nameFr, nameAr] of WILAYAS) {
    await prisma.wilaya.upsert({ where: { code }, update: { nameFr, nameAr }, create: { code, nameFr, nameAr } });
  }

  const company = await prisma.company.upsert({
    where: { id: "demo-company" },
    update: {},
    create: { id: "demo-company", name: "شركة التوزيع التجريبية" },
  });
  const cid = company.id;

  await prisma.companySettings.upsert({
    where: { companyId: cid },
    update: {},
    create: { companyId: cid, defaultLocale: "ar", currency: "DZD" },
  });

  // ── Users (one per role) ──
  const users: Array<[string, string, "Admin" | "Vendeur" | "Livreur", string]> = [
    ["gayethtayem@gmail.com", "ghaith", "Admin", "مدير النظام"],
    ["vendeur", "Vendeur@123", "Vendeur", "البائع أحمد"],
    ["livreur", "Livreur@123", "Livreur", "السائق كريم"],
  ];
  for (const [username, password, role, fullName] of users) {
    await prisma.user.upsert({
      where: { companyId_username: { companyId: cid, username } },
      update: { fullName, role },
      create: { companyId: cid, username, passwordHash: await bcrypt.hash(password, 10), fullName, role },
    });
  }
  const vendeur = await prisma.user.findFirstOrThrow({ where: { companyId: cid, username: "vendeur" } });
  const livreur = await prisma.user.findFirstOrThrow({ where: { companyId: cid, username: "livreur" } });

  // ── Reference lists ──
  const units: Array<[string, string | null, number]> = [
    ["قطعة", "pcs", 0], ["علبة", "pack", 1], ["كرتون", "ctn", 2],
    ["فاردو", "bun", 3], ["منصة", "plt", 4],
  ];
  for (const [name, symbol, sortOrder] of units) {
    await prisma.unit.upsert({
      where: { companyId_name: { companyId: cid, name } },
      update: {},
      create: { companyId: cid, name, symbol, sortOrder },
    });
  }
  const unitRows = await prisma.unit.findMany({ where: { companyId: cid } });
  const unitId = (name: string) => unitRows.find((u) => u.name === name)?.id;

  const tiers: Array<[string, number]> = [["détail", 0], ["gros", 1], ["super gros", 2]];
  for (const [name, sortOrder] of tiers) {
    await prisma.priceTier.upsert({
      where: { companyId_name: { companyId: cid, name } },
      update: {},
      create: { companyId: cid, name, sortOrder },
    });
  }
  const tierRows = await prisma.priceTier.findMany({ where: { companyId: cid } });
  const tierId = (name: string) => tierRows.find((t) => t.name === name)?.id;

  for (const name of ["وقود", "صيانة شاحنة", "أجور", "كراء", "كهرباء وماء", "أخرى"]) {
    await prisma.expenseType.upsert({
      where: { companyId_name: { companyId: cid, name } },
      update: {},
      create: { companyId: cid, name },
    });
  }
  const expenseTypeRows = await prisma.expenseType.findMany({ where: { companyId: cid } });
  const expenseTypeId = (name: string) => expenseTypeRows.find((e) => e.name === name)?.id;

  await prisma.superAdminUser.upsert({
    where: { username: "superadmin" },
    update: {},
    create: { username: "superadmin", passwordHash: await bcrypt.hash("Superadmin@123", 10) },
  });

  // ── Stores: main depot + 2 vans ──
  // Oldest match wins: if same-named rows ever exist, every re-run must
  // attach to the same one or batches/stock split across duplicates.
  async function upsertStore(name: string, data: Record<string, unknown>) {
    const existing = await prisma.store.findFirst({
      where: { companyId: cid, name },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return prisma.store.update({ where: { id: existing.id }, data });
    return prisma.store.create({ data: { companyId: cid, name, ...data } as never });
  }
  const depot = await upsertStore("Dépôt principal", { kind: "DEPOT", address: "Zone industrielle, Alger" });
  const van1 = await upsertStore("Camionnette 1", {
    kind: "VAN", marque: "Renault Master", matricule: "01234-116-16", userId: vendeur.id,
  });
  const van2 = await upsertStore("Camionnette 2", {
    kind: "VAN", marque: "Hyundai H100", matricule: "56789-109-16", userId: livreur.id,
  });
  // Extra fleet (unassigned — link chauffeurs from the Vans page).
  const extraVans: Array<[string, string, string]> = [
    ["Camionnette 3", "Peugeot Boxer", "12345-116-16"],
    ["Camionnette 4", "Fiat Ducato", "23456-116-16"],
    ["Camionnette 5", "Renault Trafic", "34567-109-16"],
    ["Camionnette 6", "Hyundai H1", "45678-119-16"],
    ["Camionnette 7", "Mercedes Sprinter", "56789-116-16"],
    ["Camionnette 8", "Iveco Daily", "67890-131-16"],
    ["Camionnette 9", "Peugeot Expert", "78901-116-16"],
    ["Camionnette 10", "Toyota Hiace", "89012-109-16"],
  ];
  for (const [name, marque, matricule] of extraVans) {
    await upsertStore(name, { kind: "VAN", marque, matricule });
  }

  // ── Van photos (generated placeholders — replace from the Vans page) ──
  await seedVanImages(cid);

  // ── Distribution sectors ──
  const secteurs: Array<[number, string]> = [
    [16, "Alger-Centre"], [31, "Oran"], [19, "Sétif"], [9, "Blida"],
  ];
  for (const [wilayaCode, name] of secteurs) {
    await prisma.secteur.upsert({
      where: { companyId_wilayaCode_name: { companyId: cid, wilayaCode, name } },
      update: {},
      create: { companyId: cid, wilayaCode, name },
    });
  }
  const secteurRows = await prisma.secteur.findMany({ where: { companyId: cid } });
  const secteurId = (name: string) => secteurRows.find((s) => s.name === name)?.id;

  // ── Product categories ──
  for (const name of ["Boissons", "Épicerie", "Hygiène", "Biscuiterie"]) {
    await prisma.productCategory.upsert({
      where: { companyId_name: { companyId: cid, name } },
      update: {},
      create: { companyId: cid, name },
    });
  }
  const catRows = await prisma.productCategory.findMany({ where: { companyId: cid } });
  const catId = (name: string) => catRows.find((c) => c.name === name)?.id;

  // ── Suppliers ──
  const suppliers: Array<[string, string, string, number, string?]> = [
    ["AGRO", "SARL AgroDiv", "0555443322", 16, secteurId("Alger-Centre")],
    ["BEN", "Ets Benali Gros", "0555667788", 19, secteurId("Sétif")],
    ["FRSH", "SPA Source Claire", "0555998877", 9, secteurId("Blida")],
  ];
  for (const [code, name, phone, wilayaCode, secId] of suppliers) {
    await prisma.supplier.upsert({
      where: { companyId_code: { companyId: cid, code } },
      update: { name, phone },
      create: { companyId: cid, code, name, phone, wilayaCode, secteurId: secId },
    });
  }
  const supRows = await prisma.supplier.findMany({ where: { companyId: cid } });
  const supId = (code: string) => supRows.find((s) => s.code === code)?.id;

  // ── Products + tier prices + opening stock ──
  // ── Products + tier prices + opening stock ──
  // Nested-colisage catalog (LabStock-simple, 3 levels max):
  //   base unit = SMALLEST unit (bottle/piece) — stock & prices live here.
  //   L1 colis   = N1 x base (e.g. 1 كرتون = 24 علبة)            factor N1
  //   L2 sur-colis = N2 x L1 (e.g. 1 فاردو = 10 كرتون)           factor N1*N2
  // purchase default = largest pack, sale default = smallest pack (L1).
  // [name, reference, barcode, category, supplier, baseUnit, l1Name, n1, l2Name|null, n2|null,
  //  salePerBase, costPerBase, minBase, openingBase]
  const products: Array<[string, string, string, string, string, string, string, number, string | null, number | null, number, number, number, number]> = [
    ["Coca-Cola (pack 6)", "CC-1L", "6130081010011", "Boissons", "FRSH", "علبة", "كرتون", 6, null, null, 145, 120, 54, 198],
    ["Fanta Orange (pack 6)", "FA-1L", "6130081010028", "Boissons", "FRSH", "علبة", "كرتون", 6, null, null, 140, 118, 54, 150],
    ["Eau minérale (pack 6)", "EM-15", "6130081010035", "Boissons", "FRSH", "علبة", "فاردو", 6, "منصة", 30, 90, 70, 180, 360],
    ["Huile tournesol", "HT-5L", "6130081020010", "Épicerie", "AGRO", "قطعة", "كرتون", 4, null, null, 1150, 1020, 20, 80],
    ["Sucre cristallisé", "SC-1K", "6130081020027", "Épicerie", "AGRO", "قطعة", "كرتون", 20, null, null, 110, 95, 60, 160],
    ["Café moulu", "CF-250", "6130081020034", "Épicerie", "BEN", "قطعة", "كرتون", 24, null, null, 320, 280, 48, 96],
    ["Lait UHT", "LU-1L", "6130081020041", "Épicerie", "AGRO", "قطعة", "كرتون", 12, null, null, 140, 125, 60, 120],
    ["Pâtes spaghetti", "PS-500", "6130081020058", "Épicerie", "BEN", "قطعة", "كرتون", 24, null, null, 95, 78, 72, 192],
    ["Lessive poudre", "LP-2K", "6130081030019", "Hygiène", "BEN", "قطعة", "كرتون", 6, null, null, 650, 560, 24, 60],
    ["Savon de Marseille", "SM-400", "6130081030026", "Hygiène", "BEN", "قطعة", "كرتون", 48, "فاردو", 10, 180, 150, 48, 144],
    ["Biscuits sandwich (carton)", "BS-24", "6130081040018", "Biscuiterie", "AGRO", "قطعة", "كرتون", 24, "فاردو", 12, 18, 15, 720, 2400],
    ["Chocolat tablette", "CT-100", "6130081040025", "Biscuiterie", "AGRO", "قطعة", "كرتون", 36, "فاردو", 8, 130, 108, 72, 144],
  ];
  const cartonId = unitId("كرتون");
  for (const [name, reference, barcode, cat, supCode, baseUnit, l1Name, n1, l2Name, n2, sale, cost, min, qty] of products) {
    const baseId = unitId(baseUnit);
    const l1Id = unitId(l1Name);
    const l2Id = l2Name ? unitId(l2Name) : undefined;
    if (!baseId || !l1Id || (l2Name && !l2Id)) throw new Error(`seed: missing unit for ${name}`);
    const total = n1 * (n2 ?? 1);
    const colisage = l2Name && n2
      ? `1 ${l2Name} = ${n2} ${l1Name} (${total} ${baseUnit})`.slice(0, 60)
      : `1 ${l1Name} = ${n1} ${baseUnit}`.slice(0, 60);
    // purchase = largest pack, sale = smallest pack (L1).
    const purchaseId = l2Id ?? l1Id;
    const saleId = l1Id;
    const packRows = l2Id
      ? [{ unitId: l1Id, factor: n1 }, { unitId: l2Id, factor: total }]
      : [{ unitId: l1Id, factor: n1 }];

    let product = await prisma.product.findFirst({ where: { companyId: cid, name } });
    if (!product) {
      product = await prisma.product.create({
        data: {
          companyId: cid, name, reference, barcode, categoryId: catId(cat), supplierId: supId(supCode),
          baseUnitId: baseId, saleUnitId: saleId, purchaseUnitId: purchaseId,
          salePrice: sale, costPrice: cost, minStock: min,
          colisage, stockQty: qty,
          conversions: { create: packRows },
        },
      });
      console.log(`  + ${name}: 1 ${l1Name} = ${n1} ${baseUnit}` + (l2Name ? ` · 1 ${l2Name} = ${n2} ${l1Name} = ${total}` : ""));
    } else if (product.baseUnitId === cartonId) {
      // ── One-way migration: legacy seed (base=كرتون + piece 1/N, prices &
      // stock in cartons) → nested model (base=smallest unit). Existing depot
      // batches are scaled ×N so ledger history stays exact. Runs once: after
      // migration base != كرتون so re-runs take the plain upsert path below.
      console.log(`  ↔ migrating ${name} to nested colisage (×${n1})…`);
      await prisma.productUnitConversion.deleteMany({ where: { productId: product.id } });
      await prisma.product.update({
        where: { id: product.id },
        data: {
          reference, barcode, categoryId: catId(cat), supplierId: supId(supCode),
          baseUnitId: baseId, saleUnitId: saleId, purchaseUnitId: purchaseId,
          salePrice: sale, costPrice: cost, minStock: min, colisage,
          stockQty: { multiply: n1 },
          conversions: { create: packRows },
        },
      });
      const batches = await prisma.stockBatch.findMany({ where: { productId: product.id } });
      for (const b of batches) {
        await prisma.stockBatch.update({
          where: { id: b.id },
          data: {
            qty: { multiply: n1 },
            initialQty: { multiply: n1 },
            unitCost: Number(b.unitCost) > 0 ? Number(b.unitCost) / n1 : undefined,
          },
        });
      }
      product = await prisma.product.findFirstOrThrow({ where: { id: product.id } });
    } else {
      product = await prisma.product.update({
        where: { id: product.id },
        data: {
          reference, barcode, categoryId: catId(cat), supplierId: supId(supCode),
          baseUnitId: baseId, saleUnitId: saleId, purchaseUnitId: purchaseId,
          salePrice: sale, costPrice: cost, minStock: min, colisage,
        },
      });
      for (const row of packRows) {
        await prisma.productUnitConversion.upsert({
          where: { productId_unitId: { productId: product.id, unitId: row.unitId } },
          update: { factor: row.factor },
          create: { productId: product.id, unitId: row.unitId, factor: row.factor },
        });
      }
      // Drop packs that are no longer in the catalog (e.g. Eau L1 كرتون → فاردو).
      await prisma.productUnitConversion.deleteMany({
        where: {
          productId: product.id,
          factor: { gte: 1 },
          unitId: { notIn: packRows.map((r) => r.unitId) },
        },
      });
    }
    // Tier prices per BASE unit: gros −5%, super gros −10%.
    const gros = tierId("gros");
    const superGros = tierId("super gros");
    if (gros) {
      await prisma.productTierPrice.upsert({
        where: { productId_tierId: { productId: product.id, tierId: gros } },
        update: { price: Math.round(sale * 0.95 * 100) / 100 },
        create: { productId: product.id, tierId: gros, price: Math.round(sale * 0.95 * 100) / 100 },
      });
    }
    if (superGros) {
      await prisma.productTierPrice.upsert({
        where: { productId_tierId: { productId: product.id, tierId: superGros } },
        update: { price: Math.round(sale * 0.9 * 100) / 100 },
        create: { productId: product.id, tierId: superGros, price: Math.round(sale * 0.9 * 100) / 100 },
      });
    }
    // Opening stock batch in the main depot (kept in sync with stockQty).
    const existing = await prisma.stockBatch.findFirst({
      where: { companyId: cid, productId: product.id, storeId: depot.id, transferId: null },
    });
    if (!existing) {
      await prisma.stockBatch.create({
        data: { companyId: cid, productId: product.id, storeId: depot.id, qty, initialQty: qty, unitCost: cost },
      });
      await prisma.product.update({ where: { id: product.id }, data: { stockQty: qty } });
    }
  }

  // ── Customers ──
  // [code, name, phone, wilayaCode, secteur, tier, creditLimit, creditDays, gpsLat, gpsLng]
  const customers: Array<[string, string, string, number, string, string, number, number, number | null, number | null]> = [
    ["CLT-0001", "Supérette El Amel", "0550123456", 16, "Alger-Centre", "gros", 50000, 30, 36.7528, 3.0421],
    ["CLT-0002", "Épicerie Nour", "0551234567", 16, "Alger-Centre", "détail", 0, 0, 36.7621, 3.0535],
    ["CLT-0003", "Supérette El Baraka", "0560123456", 31, "Oran", "gros", 80000, 30, 35.6969, -0.6331],
    ["CLT-0004", "Minimarket El Yasmine", "0660123456", 9, "Blida", "détail", 0, 0, 36.4700, 2.8300],
    ["CLT-0005", "Épicerie El Feth", "0770123456", 19, "Sétif", "gros", 60000, 30, 36.1900, 5.4100],
    ["CLT-0006", "Supérette Ennour", "0550987654", 16, "Alger-Centre", "super gros", 200000, 45, 36.7450, 3.0250],
    ["CLT-0007", "Kiosque El Chabab", "0660987654", 9, "Blida", "détail", 0, 0, null, null],
    ["CLT-0008", "Épicerie Errahma", "0770987654", 19, "Sétif", "détail", 0, 0, null, null],
  ];
  for (const [code, name, phone, wilayaCode, secteur, tier, creditLimit, creditDays, gpsLat, gpsLng] of customers) {
    await prisma.customer.upsert({
      where: { companyId_code: { companyId: cid, code } },
      update: { name, phone, wilayaCode, secteurId: secteurId(secteur), tierId: tierId(tier), creditLimit, creditDays, gpsLat, gpsLng },
      create: {
        companyId: cid, code, name, phone, wilayaCode,
        secteurId: secteurId(secteur), tierId: tierId(tier), creditLimit, creditDays, gpsLat, gpsLng,
      },
    });
  }

  // ── Sequence counters past any hardcoded codes (client create would
  // otherwise re-issue CLT-0001 and hit the unique constraint) ──
  async function bumpSequence(type: string, prefix: string) {
    const rows = await prisma.customer.findMany({
      where: { companyId: cid, code: { startsWith: `${prefix}-` } },
      select: { code: true },
    });
    let max = 0;
    for (const { code } of rows) {
      const m = new RegExp(`^${prefix}-(\\d+)$`).exec(code);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const existing = await prisma.documentSequence.findFirst({
      where: { companyId: cid, storeId: null, type, year: 0 },
    });
    if (existing) {
      if (existing.nextNo <= max) {
        await prisma.documentSequence.update({ where: { id: existing.id }, data: { nextNo: max + 1 } });
      }
    } else {
      await prisma.documentSequence.create({
        data: { companyId: cid, storeId: null, type, year: 0, nextNo: Math.max(max + 1, 1) },
      });
    }
  }
  await bumpSequence("client", "CLT");

  // ── Sample expenses ──
  const expenses: Array<[string, string, string | undefined, number]> = [
    ["Carburant camionnette 1", "وقود", van1.id, 4500],
    ["Facture électricité dépôt", "كهرباء وماء", depot.id, 8200],
    ["Vidange camionnette 1", "صيانة شاحنة", van1.id, 12000],
  ];
  for (const [label, typeName, locationId, amount] of expenses) {
    const existing = await prisma.expense.findFirst({ where: { companyId: cid, label } });
    if (!existing) {
      await prisma.expense.create({
        data: { companyId: cid, label, typeId: expenseTypeId(typeName), locationId, amount },
      });
    }
  }

  // ── Current season (services auto-create it too — this just guarantees it) ──
  const now = new Date();
  await prisma.season.upsert({
    where: { companyId_year_month: { companyId: cid, year: now.getFullYear(), month: now.getMonth() + 1 } },
    update: {},
    create: { companyId: cid, year: now.getFullYear(), month: now.getMonth() + 1, status: "open" },
  });

  // ── Today's tournee (OPEN, no stock movement until sales are made) ──
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const existingTournee = await prisma.tournee.findFirst({
    where: { companyId: cid, locationId: van1.id, date: { gte: dayStart } },
  });
  if (!existingTournee) {
    const stopClients = await prisma.customer.findMany({
      where: { companyId: cid, code: { in: ["CLT-0001", "CLT-0002", "CLT-0006"] } },
      orderBy: { code: "asc" },
    });
    await prisma.tournee.create({
      data: {
        companyId: cid,
        date: now,
        locationId: van1.id,
        secteurId: secteurId("Alger-Centre"),
        status: "OPEN",
        notes: "Tournée Alger-Centre",
        stops: { create: stopClients.map((c, i) => ({ clientId: c.id, position: i })) },
      },
    });
  }

  console.log("Seed done.");
  console.log("  Admin:   gayethtayem@gmail.com / ghaith");
  console.log("  Vendeur: vendeur / Vendeur@123");
  console.log("  Livreur: livreur / Livreur@123");

  // ── Product photos (generated branded placeholders — replace with real
  // photos from the product form anytime) ──
  await seedProductImages(cid);
}

const CATEGORY_STYLE: Record<string, [string, string]> = {
  Boissons: ["#0284c7", "#38bdf8"],
  Épicerie: ["#4d7c0f", "#84cc16"],
  Hygiène: ["#6d28d9", "#a78bfa"],
  Biscuiterie: ["#92400e", "#f59e0b"],
};

const PRODUCT_EMOJI: Array<[string, string]> = [
  ["Coca-Cola", "🥤"], ["Fanta", "🍊"], ["Eau minérale", "💧"],
  ["Huile", "🫒"], ["Sucre", "🍬"], ["Café", "☕"],
  ["Lait", "🥛"], ["Pâtes", "🍝"], ["Lessive", "🧺"],
  ["Savon", "🧼"], ["Biscuits", "🍪"], ["Chocolat", "🍫"],
];

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const VAN_COLORS: Array<[string, string]> = [
  ["#047857", "#34d399"], ["#1d4ed8", "#38bdf8"], ["#b45309", "#fbbf24"],
  ["#6d28d9", "#a78bfa"], ["#be123c", "#fb7185"], ["#0f766e", "#2dd4bf"],
  ["#9a3412", "#fb923c"], ["#4c1d95", "#818cf8"], ["#713f12", "#facc15"],
  ["#155e75", "#22d3ee"],
];

async function seedVanImages(companyId: string) {
  const dir = join(process.cwd(), "public", "uploads", "vans");
  await mkdir(dir, { recursive: true });
  const vans = await prisma.store.findMany({ where: { companyId, kind: "VAN" }, orderBy: { name: "asc" } });
  let i = 0;
  for (const v of vans) {
    if (v.imageUrl) {
      i++;
      continue;
    }
    const [c1, c2] = VAN_COLORS[i % VAN_COLORS.length];
    const file = `seed-${v.id}.svg`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#g)"/>` +
      `<circle cx="320" cy="140" r="82" fill="rgba(255,255,255,0.18)"/>` +
      `<text x="320" y="178" font-size="92" text-anchor="middle">🚚</text>` +
      `<text x="320" y="278" font-size="34" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${escXml(v.name)}</text>` +
      `<text x="320" y="312" font-size="20" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-family="sans-serif">${escXml(v.matricule ?? "")}</text>` +
      `</svg>`;
    await writeFile(join(dir, file), svg);
    await prisma.store.update({ where: { id: v.id }, data: { imageUrl: `/uploads/vans/${file}` } });
    i++;
  }
}

async function seedProductImages(companyId: string) {
  const dir = join(process.cwd(), "public", "uploads", "products");
  await mkdir(dir, { recursive: true });
  const products = await prisma.product.findMany({
    where: { companyId },
    include: { category: true, images: true },
  });
  for (const p of products) {
    if (p.images.length > 0) continue; // keep real photos, never overwrite
    const emoji = PRODUCT_EMOJI.find(([k]) => p.name.startsWith(k))?.[1] ?? "📦";
    const [c1, c2] = CATEGORY_STYLE[p.category?.name ?? ""] ?? ["#334155", "#64748b"];
    const file = `seed-${p.id}.svg`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#g)"/>` +
      `<circle cx="320" cy="140" r="82" fill="rgba(255,255,255,0.18)"/>` +
      `<text x="320" y="175" font-size="88" text-anchor="middle">${emoji}</text>` +
      `<text x="320" y="278" font-size="32" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${escXml(p.name)}</text>` +
      `<text x="320" y="312" font-size="19" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-family="sans-serif">${escXml(p.reference ?? "")}</text>` +
      `</svg>`;
    await writeFile(join(dir, file), svg);
    await prisma.productImage.create({
      data: { productId: p.id, url: `/uploads/products/${file}`, sortOrder: 0 },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
