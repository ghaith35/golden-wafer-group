import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";

// Dashboard demo data for the EXISTING login company: ~60 days of delivered
// van / depot / POS sales (with COGS snapshots), expenses per van, customer
// and supplier debts, and a few low-stock products — so every panel of the
// executive dashboard has something to show.
//
//   npx tsx --env-file=.env scripts/seed-dashboard-demo.ts            # seed
//   npx tsx --env-file=.env scripts/seed-dashboard-demo.ts --reset    # remove it again
//
// Everything is tagged (sale numbers "DEMO-…", expense labels "[DEMO] …") and
// every pre-existing row it touches (customer / supplier balances, product
// stock thresholds) is recorded in backups/demo-seed-state.json so --reset
// puts it back exactly. Stock batches are NOT consumed by the demo sales.

const RESET = process.argv.includes("--reset");
const STATE = path.join(process.cwd(), "backups", "demo-seed-state.json");

let seed = 20261119;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const round2 = (n: number) => Math.round(n * 100) / 100;
function weighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

type State = {
  customerDeltas: Record<string, number>;
  products: Record<string, { stockQty: string; minStock: string }>;
  suppliers: Record<string, string>;
  expenseTypeIds: string[];
};

async function main() {
  const company = await prisma.company.findFirst({ where: { users: { some: { username: "gayethtayem@gmail.com" } } } });
  if (!company) throw new Error("login company not found");
  const cid = company.id;
  console.log(`company: ${company.name}`);

  if (RESET) {
    const sales = await prisma.sale.deleteMany({ where: { companyId: cid, number: { startsWith: "DEMO-" } } });
    const exp = await prisma.expense.deleteMany({ where: { companyId: cid, label: { startsWith: "[DEMO]" } } });
    console.log(`removed ${sales.count} sales, ${exp.count} expenses`);
    if (fs.existsSync(STATE)) {
      const st = JSON.parse(fs.readFileSync(STATE, "utf8")) as State;
      for (const [id, d] of Object.entries(st.customerDeltas)) await prisma.customer.update({ where: { id }, data: { balance: { decrement: d } } });
      for (const [id, p] of Object.entries(st.products)) await prisma.product.update({ where: { id }, data: { stockQty: p.stockQty, minStock: p.minStock } });
      for (const [id, b] of Object.entries(st.suppliers)) await prisma.supplier.update({ where: { id }, data: { balance: b } });
      if (st.expenseTypeIds.length) await prisma.expenseType.deleteMany({ where: { id: { in: st.expenseTypeIds }, expenses: { none: {} } } });
      fs.rmSync(STATE);
      console.log("restored balances / stock thresholds");
    }
    return;
  }

  if (await prisma.sale.findFirst({ where: { companyId: cid, number: { startsWith: "DEMO-" } }, select: { id: true } })) {
    console.log("demo data already present — run with --reset first to rebuild it");
    return;
  }

  const admin = await prisma.user.findFirst({ where: { companyId: cid, role: "Admin" } });
  const depot = await prisma.store.findFirst({ where: { companyId: cid, kind: "DEPOT" }, orderBy: { createdAt: "asc" } });
  const vans = await prisma.store.findMany({ where: { companyId: cid, kind: "VAN", isActive: true }, orderBy: { name: "asc" } });
  const carton = await prisma.unit.findFirst({ where: { companyId: cid, name: "كرتون" } });
  if (!admin || !depot || vans.length === 0) throw new Error("missing admin / depot / vans");

  // Products: real catalogue first (ranked best-sellers), generated BLK-* after.
  const prodRows = await prisma.product.findMany({
    where: { companyId: cid, isActive: true, salePrice: { gt: 0 } },
    select: { id: true, name: true, reference: true, salePrice: true, costPrice: true, stockQty: true, minStock: true, conversions: { select: { factor: true } } },
  });
  const isReal = (r: string | null) => !(r ?? "").startsWith("BLK-");
  prodRows.sort((a, b) => Number(isReal(b.reference)) - Number(isReal(a.reference)));
  const real = prodRows.filter((p) => isReal(p.reference)).sort(() => rnd() - 0.5);
  const gen = prodRows.filter((p) => !isReal(p.reference)).sort(() => rnd() - 0.5);
  const prods = [...real, ...gen];
  const pW = prods.map((_, i) => 1 / Math.pow(i + 1, 0.85));

  // Customers: real ones first so top-customer lists read naturally.
  const custRows = await prisma.customer.findMany({ where: { companyId: cid, isActive: true }, select: { id: true, code: true } });
  const realC = custRows.filter((c) => !c.code.startsWith("BULK-C-")).sort(() => rnd() - 0.5);
  const genC = custRows.filter((c) => c.code.startsWith("BULK-C-")).sort(() => rnd() - 0.5);
  const custs = [...realC, ...genC];
  const cW = custs.map((_, i) => 1 / Math.pow(i + 1, 0.95));

  // Van strengths (some vans clearly outsell others; one is idle some days).
  const vanOrder = [...vans].sort(() => rnd() - 0.5);
  const vanW = vanOrder.map((_, i) => Math.max(0.12, 1.7 - i * 0.17));

  const now = new Date();
  const seasons = new Map<string, string>();
  async function seasonFor(d: Date) {
    const k = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!seasons.has(k)) {
      const s = await prisma.season.upsert({
        where: { companyId_year_month: { companyId: cid, year: d.getFullYear(), month: d.getMonth() + 1 } },
        update: {},
        create: { companyId: cid, year: d.getFullYear(), month: d.getMonth() + 1, status: "open" },
      });
      seasons.set(k, s.id);
    }
    return seasons.get(k)!;
  }

  const saleRows: Array<Record<string, unknown>> = [];
  const lineRows: Array<Record<string, unknown>> = [];
  const customerDeltas: Record<string, number> = {};
  const seqByKind: Record<string, number> = { DELIVERY: 0, TICKET: 0 };

  for (let d = 61; d >= 0; d--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const dow = day.getDay(); // 5 = Friday
    const weekly = dow === 5 ? 0.35 : dow === 6 ? 0.8 : 1;
    const growth = 0.72 + 0.5 * (1 - d / 62);
    const noise = 0.7 + rnd() * 0.6;
    let count = Math.round(15 * weekly * growth * noise);
    if (d === 0) count = Math.max(5, Math.round(count * Math.min(1, (now.getHours() - 5) / 12)));
    const startMin = 6 * 60 + 15;
    const endMin = d === 0 ? Math.max(startMin + 20, now.getHours() * 60 + now.getMinutes() - 1) : 19 * 60;
    const seasonId = await seasonFor(day);

    for (let i = 0; i < count; i++) {
      const minute = int(startMin, endMin);
      const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minute / 60), minute % 60, int(0, 59));
      if (date.getTime() > now.getTime()) continue;
      const r = rnd();
      const channel = r < 0.78 ? "VAN" : r < 0.92 ? "DEPOT" : "POS";
      const van = channel === "VAN" ? weighted(vanOrder, vanW) : null;
      const location = van ?? depot;
      const kind = channel === "VAN" ? (rnd() < 0.75 ? "TICKET" : "DELIVERY") : channel === "POS" ? "TICKET" : rnd() < 0.6 ? "DELIVERY" : "TICKET";
      const clientId = rnd() < (channel === "VAN" ? 0.92 : 0.62) ? weighted(custs, cW).id : null;

      const saleId = randomUUID();
      let total = 0;
      const nLines = weighted([1, 2, 3, 4], [4, 5, 3, 1.2]);
      const used = new Set<string>();
      for (let l = 0; l < nLines; l++) {
        const p = weighted(prods, pW);
        if (used.has(p.id)) continue;
        used.add(p.id);
        const factor = p.conversions[0]?.factor ? Number(p.conversions[0].factor) : 12;
        const price = round2(Number(p.salePrice) * (0.97 + rnd() * 0.07));
        const cost = Number(p.costPrice) > 0 ? Number(p.costPrice) : round2(Number(p.salePrice) * 0.78);
        const target = Math.exp(Math.log(3000) + rnd() * (Math.log(45000) - Math.log(3000)));
        const cartons = Math.max(1, Math.min(14, Math.round(target / (factor * price))));
        const baseQty = cartons * factor;
        const lineTotal = round2(baseQty * price);
        total += lineTotal;
        lineRows.push({ id: randomUUID(), saleId, productId: p.id, unitId: carton?.id ?? null, qty: cartons, baseQty, unitPrice: price, remise: 0, lineTotal, unitCost: cost });
      }
      total = round2(total);
      const pr = rnd();
      const paid = !clientId || pr < 0.6 ? total : pr < 0.85 ? round2(total * (0.3 + rnd() * 0.5)) : 0;
      if (clientId && total - paid > 0) customerDeltas[clientId] = round2((customerDeltas[clientId] ?? 0) + (total - paid));
      seqByKind[kind]++;
      saleRows.push({
        id: saleId, companyId: cid, seasonId, kind, status: "DELIVERED", channel,
        number: `DEMO-${kind === "TICKET" ? "T" : "D"}-${String(seqByKind[kind]).padStart(5, "0")}`,
        clientId, locationId: location.id, createdById: admin.id, remise: 0, total, paid, date, notes: "DEMO",
      });
    }
  }

  for (const part of chunk(saleRows, 400)) await prisma.sale.createMany({ data: part as never });
  for (const part of chunk(lineRows, 1500)) await prisma.saleLine.createMany({ data: part as never });
  console.log(`sales: +${saleRows.length} (${lineRows.length} lines)`);

  // Customer debts from the unpaid part of the demo sales.
  for (const [id, delta] of Object.entries(customerDeltas)) await prisma.customer.update({ where: { id }, data: { balance: { increment: delta } } });
  console.log(`customer debts: ${Object.keys(customerDeltas).length} customers`);

  // Expense types + expenses (per van and company-wide).
  const typeIds: string[] = [];
  const tid: Record<string, string> = {};
  for (const name of ["وقود", "صيانة الشاحنات", "نقل وتحميل", "أجور", "كراء ومرافق"]) {
    let t = await prisma.expenseType.findFirst({ where: { companyId: cid, name } });
    if (!t) {
      t = await prisma.expenseType.create({ data: { companyId: cid, name } });
      typeIds.push(t.id);
    }
    tid[name] = t.id;
  }
  const expRows: Array<Record<string, unknown>> = [];
  for (let d = 61; d >= 0; d--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, int(7, 17), int(0, 59));
    if (day.getTime() > now.getTime()) continue;
    const seasonId = await seasonFor(day);
    const push = (type: string, label: string, amount: number, locationId: string | null) =>
      expRows.push({ id: randomUUID(), companyId: cid, seasonId, typeId: tid[type], locationId, label: `[DEMO] ${label}`, amount, expenseDate: day });
    for (const v of vanOrder) {
      if (rnd() < 0.3) push("وقود", "وقود", int(30, 95) * 100, v.id);
      if (rnd() < 0.04) push("صيانة الشاحنات", "صيانة", int(40, 400) * 100, v.id);
      if (rnd() < 0.06) push("نقل وتحميل", "تحميل", int(10, 40) * 100, v.id);
    }
    if (day.getDate() === 1) push("كراء ومرافق", "كراء المخزن", 150000, null);
    if (day.getDate() === 25) push("أجور", "أجور العمال", int(380, 520) * 1000, null);
    if (day.getDate() === 12) push("كراء ومرافق", "كهرباء وماء", int(18, 34) * 1000, null);
  }
  await prisma.expense.createMany({ data: expRows as never });
  console.log(`expenses: +${expRows.length}`);

  // Low-stock products (best sellers running low) + supplier debts.
  const state: State = { customerDeltas, products: {}, suppliers: {}, expenseTypeIds: typeIds };
  for (const p of real.slice(0, 5)) {
    state.products[p.id] = { stockQty: String(p.stockQty), minStock: String(p.minStock) };
    await prisma.product.update({ where: { id: p.id }, data: { stockQty: int(0, 14), minStock: int(24, 60) } });
  }
  const sups = await prisma.supplier.findMany({ where: { companyId: cid }, select: { id: true, balance: true }, take: 4 });
  const debts = [85000, 240000, 38000, 120000];
  for (let i = 0; i < sups.length; i++) {
    state.suppliers[sups[i].id] = String(sups[i].balance);
    await prisma.supplier.update({ where: { id: sups[i].id }, data: { balance: debts[i] } });
  }
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log("DEMO seed done. Undo with: npx tsx --env-file=.env scripts/seed-dashboard-demo.ts --reset");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
