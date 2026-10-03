/// LabStock-style nested colisage builder for distribuili.
///
/// Model (no schema change):
///   base unit  = smallest unit (e.g. Bouteille / Pièce)      factor 1
///   colis L1   = N1 x base        (e.g. Carton = 24 x Bouteille)   factor N1
///   sur-colis L2 = N2 x L1 = N1*N2 x base (e.g. Fardeau = 10 x Carton) factor N1*N2
///
/// Stored as ProductUnitConversion rows with factor > 1 + auto colisage text.
/// Backend math (qty * factor, price * factor) already handles this — see
/// src/lib/sales/service.ts and src/lib/purchases/service.ts.

export type ColisMode = "unite" | "simple" | "double";

export type ColisDraft = {
  mode: ColisMode;
  /// L1: name typed by user (matched to existing unit or created on save)
  l1Name: string;
  /// N1: base units per L1
  l1Qty: number | "";
  l1Barcode: string;
  /// L2: name typed by user
  l2Name: string;
  /// N2: L1 packs per L2
  l2Qty: number | "";
  l2Barcode: string;
};

export const EMPTY_COLIS: ColisDraft = {
  mode: "unite",
  l1Name: "",
  l1Qty: "",
  l1Barcode: "",
  l2Name: "",
  l2Qty: "",
  l2Barcode: "",
};

/// Infer the builder draft from existing conversions (factor > 1 only).
/// Legacy seed products (base=carton + piece factor 1/N) have no packs above
/// base → draft stays "unite" and legacy pieces are preserved untouched.
export function draftFromConversions(
  conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit?: { name?: string } | null }>,
  resolveName: (id: string) => string,
): ColisDraft {
  const packs = [...conversions]
    .filter((c) => c.unitId && c.factor > 1)
    .sort((a, b) => a.factor - b.factor);
  if (packs.length === 0) return { ...EMPTY_COLIS };
  if (packs.length === 1) {
    const [l1] = packs;
    return {
      mode: "simple",
      l1Name: l1.unit?.name ?? resolveName(l1.unitId),
      l1Qty: l1.factor,
      l1Barcode: l1.barcode ?? "",
      l2Name: "",
      l2Qty: "",
      l2Barcode: "",
    };
  }
  const [l1, l2] = packs.slice(-2);
  const n1 = l1.factor;
  const n2 = Math.round(l2.factor / l1.factor);
  return {
    mode: "double",
    l1Name: l1.unit?.name ?? resolveName(l1.unitId),
    l1Qty: n1,
    l1Barcode: l1.barcode ?? "",
    l2Name: l2.unit?.name ?? resolveName(l2.unitId),
    l2Qty: n2,
    l2Barcode: l2.barcode ?? "",
  };
}

/// Auto colisage text, e.g. "1 Carton = 24 Bouteille" or
/// "1 Fardeau = 10 Carton (240 Bouteille)".
/// Kept ≤ 60 chars (Product.colisage limit).
export function buildColisageText(baseName: string, d: ColisDraft): string | null {
  const n1 = Number(d.l1Qty);
  if (d.mode === "unite" || !d.l1Name.trim() || !(n1 > 0)) return null;
  const l1 = d.l1Name.trim();
  if (d.mode === "simple") {
    return `1 ${l1} = ${n1} ${baseName}`.slice(0, 60);
  }
  const n2 = Number(d.l2Qty);
  if (!d.l2Name.trim() || !(n2 > 0)) {
    return `1 ${l1} = ${n1} ${baseName}`.slice(0, 60);
  }
  const l2 = d.l2Name.trim();
  const total = n1 * n2;
  // "1 Fardeau = 10 Carton (240 Bouteille)"
  const explicit = `1 ${l2} = ${n2} ${l1} (${total} ${baseName})`;
  if (explicit.length <= 60) return explicit;
  const full = `${n1} x ${baseName} / ${n2} x ${l1} (=${total})`;
  return full.slice(0, 60);
}

/// Factors preview: L1 = N1, L2 = N1*N2.
export function previewFactors(d: ColisDraft): { n1: number; n2: number; total: number } | null {
  const n1 = Number(d.l1Qty);
  if (d.mode === "unite" || !(n1 > 0) || !d.l1Name.trim()) return null;
  if (d.mode === "simple") return { n1, n2: 0, total: n1 };
  const n2 = Number(d.l2Qty);
  if (!(n2 > 0) || !d.l2Name.trim()) return { n1, n2: 0, total: n1 };
  return { n1, n2, total: n1 * n2 };
}

/// Level-respecting equivalence: each pack expressed in the unit DIRECTLY
/// below it — "1 منصة = 30 فاردو", "1 فاردو = 6 علبة" — never flattened to
/// base ("1 منصة = 180 علبة"). A palette holds fardeaux, not loose bottles.
export function levelLabel(
  packsAsc: Array<{ name: string; factor: number }>,
  index: number,
  baseName: string,
): string {
  const lv = packsAsc[index];
  const childName = index === 0 ? baseName : packsAsc[index - 1].name;
  const childFactor = index === 0 ? 1 : packsAsc[index - 1].factor;
  const qty = childFactor > 0 ? Math.round((lv.factor / childFactor) * 1000) / 1000 : lv.factor;
  // en-US grouping (comma) is bidi-safe: a space grouper would split the
  // number into two bidi runs in RTL ("2 296" -> "296 2").
  return `1 ${lv.name} = ${qty.toLocaleString("en-US")} ${childName}`;
}

/// Total across mixed products: whole top-level packs summed per product +
/// base units. E.g. {packs: 16, names: ["كرتون"], units: 384} → "384 (16 كرتون)".
/// Different pack names fall back to the generic "كولي".
export function mixedColisTotal(
  rows: Array<{ qty: number; packsAsc: Array<{ name: string; factor: number }> }>
): { packs: number; packName: string | null; units: number } {
  let packs = 0;
  const names = new Set<string>();
  let units = 0;
  for (const r of rows) {
    units += r.qty;
    const top = r.packsAsc[r.packsAsc.length - 1];
    if (top && top.factor > 1) {
      packs += Math.floor(r.qty / top.factor + 1e-9);
      names.add(top.name);
    }
  }
  return { packs, packName: names.size === 1 ? [...names][0] : packs > 0 ? "كولي" : null, units };
}

/// Human breakdown of a base qty into L2/L1/base, e.g. "2 Grand + 3 Carton + 5 Bouteille".
export function breakdownNested(
  baseQty: number,
  baseName: string,
  l1: { name: string; factor: number } | null,
  l2: { name: string; factor: number } | null,
): string {
  let rest = Math.round(baseQty * 1000) / 1000;
  const parts: string[] = [];
  const levels = [l2, l1].filter((x): x is { name: string; factor: number } => !!x && x.factor > 1);
  for (const lv of levels) {
    const n = Math.floor(rest / lv.factor);
    if (n > 0) {
      parts.push(`${n.toLocaleString("en-US")} ${lv.name}`);
      rest = Math.round((rest - n * lv.factor) * 1000) / 1000;
    }
  }
  if (rest > 0 || parts.length === 0) {
    parts.push(
      `${rest.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${baseName}`,
    );
  }
  return parts.join(" + ");
}
