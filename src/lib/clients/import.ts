/// Bulk client import from Excel/CSV: pure helpers shared by the upload UI
/// (preview) and the API route (server-side re-validation). No DOM, no xlsx
/// import here — the component feeds raw 2D arrays, so this stays unit-testable.

export type ImportRow = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  /// 1-based spreadsheet line (header = 1) for error reports.
  line: number;
};

/// Algerian mobile: strip everything but digits, tolerate +213 / spaces.
/// Returns the normalized 10-digit number, or null when absent/unusable.
export function normalizeImportPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    s = String(Math.trunc(raw));
  } else {
    s = String(raw).trim();
    if (!s) return null;
  }
  let digits = s.replace(/\D/g, "");
  if (digits.startsWith("213")) digits = "0" + digits.slice(3);
  // Excel drops the leading zero of numeric cells (664328954 instead of
  // 0664328954) — restore it for 9-digit mobiles.
  if (/^[567][0-9]{8}$/.test(digits)) digits = "0" + digits;
  if (!/^(0)(5|6|7)[0-9]{8}$/.test(digits)) return null;
  return digits;
}

const HEADER_ALIASES: Record<string, "name" | "phone" | "email" | "address" | "status"> = {
  nom: "name",
  name: "name",
  "nom client": "name",
  client: "name",
  "téléphone": "phone",
  telephone: "phone",
  phone: "phone",
  tel: "phone",
  "n° téléphone": "phone",
  email: "email",
  "e-mail": "email",
  adresse: "address",
  address: "address",
  statut: "status",
  status: "status",
  état: "status",
};

/// Map a header row (raw cell values) to column indexes. Unknown/missing
/// columns stay -1; name is required, everything else optional.
export function mapImportHeaders(header: unknown[]): {
  name: number;
  phone: number;
  email: number;
  address: number;
  status: number;
} {
  const out = { name: -1, phone: -1, email: -1, address: -1, status: -1 };
  header.forEach((cell, i) => {
    const key = String(cell ?? "").trim().toLowerCase();
    const kind = HEADER_ALIASES[key];
    if (kind && out[kind] === -1) out[kind] = i;
  });
  return out;
}

function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseActive(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  const s = String(v).trim().toLowerCase();
  if (["inactive", "inactif", "non", "no", "false", "0", "désactivé", "desactive"].includes(s)) return false;
  return true;
}

/// Shape raw sheet rows (header already consumed) into ImportRows.
/// Rows without a name are dropped (counted as skipped_empty).
export function shapeImportRows(
  dataRows: unknown[][],
  cols: { name: number; phone: number; email: number; address: number; status: number },
  firstLine = 2
): { rows: ImportRow[]; skippedEmpty: number } {
  const rows: ImportRow[] = [];
  let skippedEmpty = 0;
  dataRows.forEach((r, i) => {
    const name = cols.name >= 0 ? cellText(r[cols.name]) : null;
    if (!name) {
      // Fully blank line at the tail is normal — still counted, UI ignores it.
      skippedEmpty += 1;
      return;
    }
    rows.push({
      name: name.slice(0, 120),
      phone: cols.phone >= 0 ? normalizeImportPhone(r[cols.phone]) : null,
      email: cols.email >= 0 ? cellText(r[cols.email])?.slice(0, 120) ?? null : null,
      address: cols.address >= 0 ? cellText(r[cols.address])?.slice(0, 255) ?? null : null,
      isActive: cols.status >= 0 ? parseActive(r[cols.status]) : true,
      line: firstLine + i,
    });
  });
  return { rows, skippedEmpty };
}
