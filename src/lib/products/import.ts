/// Bulk product import from Excel/CSV: pure helpers shared by the upload UI
/// (preview) and the API route (server-side re-validation).

export type ProductImportRow = {
  name: string;
  reference: string | null;
  barcode: string | null;
  costPrice: number;
  salePrice: number;
  /// Opening stock → an initial depot batch (null = none).
  stock: number | null;
  isActive: boolean;
  /// 1-based spreadsheet line (header = 1) for error reports.
  line: number;
};

/// French formatted amounts: "51,00 DA", "1 250,50 DA", 67.5, 1095…
/// Returns a finite ≥0 number, defaulting to 0 when unreadable.
export function parseImportPrice(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  let s = String(raw).replace(/[\s\u00a0\u202f\u2066\u2069]/g, "");
  s = s.replace(/[^0-9,.\-]/g, "");
  if (!s) return 0;
  // "1.250,50" (FR thousands) vs "1250.50": last separator wins as decimal.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const v = Number(s);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0;
}

/// Stock quantities: plain numbers, may arrive as "639" text or 639.
export function parseImportStock(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const v = typeof raw === "number" ? raw : Number(String(raw).replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 1000) / 1000;
}

const HEADER_ALIASES: Record<string, "name" | "reference" | "barcode" | "cost" | "sale" | "stock" | "status"> = {
  "désignation": "name",
  designation: "name",
  name: "name",
  produit: "name",
  article: "name",
  "référence": "reference",
  reference: "reference",
  "ref": "reference",
  "code-barres": "barcode",
  "code barres": "barcode",
  barcode: "barcode",
  "codebarre": "barcode",
  "eAN": "barcode",
  ean: "barcode",
  "prix d'achat": "cost",
  "prix d achat": "cost",
  "prix achat": "cost",
  cost: "cost",
  "purchase price": "cost",
  "prix de vente": "sale",
  "prix vente": "sale",
  sale: "sale",
  price: "sale",
  "sale price": "sale",
  stock: "stock",
  "quantité": "stock",
  quantite: "stock",
  qty: "stock",
  statut: "status",
  status: "status",
  "état": "status",
  etat: "status",
};

export function mapProductHeaders(header: unknown[]): {
  name: number;
  reference: number;
  barcode: number;
  cost: number;
  sale: number;
  stock: number;
  status: number;
} {
  const out = { name: -1, reference: -1, barcode: -1, cost: -1, sale: -1, stock: -1, status: -1 };
  header.forEach((cell, i) => {
    const key = String(cell ?? "").trim().toLowerCase();
    const kind = HEADER_ALIASES[key];
    if (kind && out[kind] === -1) out[kind] = i;
  });
  return out;
}

function cellText(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function parseActive(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  const s = String(v).trim().toLowerCase();
  if (["inactif", "inactive", "non", "no", "false", "0", "désactivé", "desactive"].includes(s)) return false;
  return true;
}

export function shapeProductRows(
  dataRows: unknown[][],
  cols: { name: number; reference: number; barcode: number; cost: number; sale: number; stock: number; status: number },
  firstLine = 2
): { rows: ProductImportRow[]; skippedEmpty: number } {
  const rows: ProductImportRow[] = [];
  let skippedEmpty = 0;
  dataRows.forEach((r, i) => {
    const name = cols.name >= 0 ? cellText(r[cols.name], 120) : null;
    if (!name) {
      skippedEmpty += 1;
      return;
    }
    rows.push({
      name,
      reference: cols.reference >= 0 ? cellText(r[cols.reference], 60) : null,
      barcode: cols.barcode >= 0 ? cellText(r[cols.barcode], 60) : null,
      costPrice: cols.cost >= 0 ? parseImportPrice(r[cols.cost]) : 0,
      salePrice: cols.sale >= 0 ? parseImportPrice(r[cols.sale]) : 0,
      stock: cols.stock >= 0 ? parseImportStock(r[cols.stock]) : null,
      isActive: cols.status >= 0 ? parseActive(r[cols.status]) : true,
      line: firstLine + i,
    });
  });
  return { rows, skippedEmpty };
}
