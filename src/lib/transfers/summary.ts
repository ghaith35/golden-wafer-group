/// Display maths for van restock requests (depot → van transfers). PURE: used by
/// the requests board, the popup and the printed transfer note, so every screen
/// shows the same totals.

export type SummaryProduct = {
  conversions?: Array<{ unitId?: string; factor: unknown }> | null;
} | null;

export type SummaryLine = {
  declaredQty: unknown;
  confirmedQty: unknown;
  product: SummaryProduct;
};

/// Base units per colis: the smallest conversion bigger than 1 (the product's
/// pack), or 0 when the product has no pack.
export function packFactor(p: SummaryProduct): number {
  const factors = (p?.conversions ?? []).map((c) => Number(c.factor)).filter((f) => Number.isFinite(f) && f > 1);
  return factors.length ? Math.min(...factors) : 0;
}

/// The quantity a line stands for: what the office confirmed, else what the
/// van asked for.
export function lineQty(l: Pick<SummaryLine, "declaredQty" | "confirmedQty">): number {
  const q = l.confirmedQty != null ? Number(l.confirmedQty) : Number(l.declaredQty ?? 0);
  return Number.isFinite(q) ? q : 0;
}

/// Colis (packs) of a line, null when the product has no pack.
export function lineColis(l: SummaryLine): number | null {
  const f = packFactor(l.product);
  return f > 0 ? Math.round((lineQty(l) / f) * 100) / 100 : null;
}

export type RequestSummary = {
  /// Number of distinct lines (products).
  products: number;
  /// Total colis over the lines that have a pack.
  colis: number;
  /// Total base units (pieces) over all lines.
  pieces: number;
};

export function summarize(lines: SummaryLine[]): RequestSummary {
  let colis = 0;
  let pieces = 0;
  for (const l of lines) {
    pieces += lineQty(l);
    colis += lineColis(l) ?? 0;
  }
  return { products: lines.length, colis: Math.round(colis * 100) / 100, pieces: Math.round(pieces * 1000) / 1000 };
}
