// eslint-disable-next-line @typescript-eslint/triple-slash-reference
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { buildVanSheetPdf } from "@/lib/pdf/vanSheetPdf";
import { packBreakdown } from "@/components/products/UnitQty";

(globalThis as unknown as Record<string, unknown>).FileReader = undefined;

async function main() {
  const companyId = "demo-company";
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const van = await prisma.store.findFirstOrThrow({ where: { companyId, kind: "VAN" }, orderBy: { name: "asc" } });
  const batches = await prisma.stockBatch.findMany({
    where: { companyId, storeId: van.id, transferId: null, qty: { gt: 0 } },
    include: { product: { include: { baseUnit: true, conversions: { include: { unit: true } } } } },
    take: 12,
  });
  if (!batches.length) throw new Error("no stock on first van — seed first");
  const rows = batches.slice(0, 6).map((b) => {
    const p = b.product;
    const qty = Number(b.qty);
    const uname = (id: string) => p.conversions.find((c) => c.unitId === id)?.unit.name ?? "";
    const base = p.baseUnit?.name ?? "";
    return {
      name: p.name,
      reference: "",
      colis: packBreakdown(
        qty,
        p.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) })),
        uname,
        base
      ),
      units: `${qty} ${base}`.trim(),
      value: qty * Number(b.unitCost),
    };
  });
  const origFetch = globalThis.fetch;
  (globalThis as unknown as Record<string, unknown>).fetch = (url: unknown, ...rest: unknown[]) => {
    if (typeof url === "string" && url.startsWith("/")) return (origFetch as typeof fetch)(`http://localhost:3000${url}`, ...(rest as []));
    return (origFetch as typeof fetch)(url as string, ...(rest as []));
  };
  const labels = {
    sheet: "كشف المخزون", product: "المنتج", reference: "المرجع", colisage: "التعليب",
    units: "الوحدات", value: "القيمة", total: "المجموع", driver: "السائق",
    date: "التاريخ", page: "صفحة",
  };
  const blob = await buildVanSheetPdf({
    van: { name: van.name, matricule: van.matricule },
    driverName: "test",
    company: {
      name: company?.name ?? "",
      phone: company?.phone,
      address: company?.address,
      rc: company?.rc,
      nif: company?.nif,
      ai: company?.ai,
      logoUrl: null,
      signatureUrl: null,
      stampUrl: null,
    },
    currency: "DZD",
    date: "29/09/2026",
    rows,
    totals: { units: rows.length, value: rows.reduce((s, r) => s + r.value, 0) },
    labels,
  });
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync("/tmp/sheet-test.pdf", buf);
  console.log("wrote", buf.length, "bytes,", rows.length, "rows");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
