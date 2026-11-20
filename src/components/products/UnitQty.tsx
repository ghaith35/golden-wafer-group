"use client";

import { levelLabel } from "@/lib/products/colisage";

export type UnitAwareProduct = {
  baseUnitId: string | null;
  baseUnit?: { id?: string; name: string } | null;
  saleUnitId?: string | null;
  purchaseUnitId?: string | null;
  colisage?: string | null;
  barcode?: string | null;
  conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit?: { id?: string; name: string } }>;
};

/// Finds a product by product- or pack-level barcode.
/// Returns the product plus the matching pack unit ("" = base unit).
export function findByBarcode<T extends UnitAwareProduct & { id: string }>(
  products: T[],
  code: string
): { product: T; unitId: string } | null {
  const needle = code.trim().toLowerCase();
  if (!needle) return null;
  for (const p of products) {
    if ((p.barcode ?? "").toLowerCase() === needle) return { product: p, unitId: "" };
    const conv = p.conversions.find((c) => (c.barcode ?? "").toLowerCase() === needle);
    if (conv) return { product: p, unitId: conv.unitId };
  }
  return null;
}

const COUNTABLE_WORDS = ["pcs", "pc", "piece", "pieces", "pièce", "pièces", "unité", "unités", "unite", "unites", "قطعة", "قطع", "حبة", "حبات", "علبة", "علب", "كرتون", "كراتين", "carton", "cartons", "pack", "packs", "palette", "boite", "boîte", "sachet", "paquet", "bouteille", "pièce"];

/// Canonical line summary (purchase / sale lines):
///   50 كرتون / 80 DA
///   13.33 DA / قطعة =
///   = 300 قطعة
export function LinePriceSummary({
  qty,
  unit,
  price,
  currency,
  pieceUnit,
  piecePrice,
  pieceQty,
  freeQty,
}: {
  qty: number;
  unit: string;
  price: number;
  currency: string;
  pieceUnit?: string;
  piecePrice?: number;
  pieceQty?: number;
  freeQty?: number;
}) {
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="mt-0.5 text-[11px] font-black">
      <div className="truncate text-start">
        <bdi>{qty}</bdi>{unit ? ` ${unit}` : ""}{freeQty ? ` +${freeQty}` : ""} × <bdi>{n(price)} {currency}</bdi>
      </div>
      {pieceUnit && piecePrice != null && (
        <div className="truncate text-start text-(--brand-600)">
          <bdi>{n(piecePrice)} {currency} / {pieceUnit}</bdi>
        </div>
      )}
      {pieceUnit && pieceQty != null && (
        <div className="truncate text-start text-(--brand-600)">= <bdi>{n(pieceQty)}</bdi> {pieceUnit}</div>
      )}
    </div>
  );
}

/// Weight/volume specs ("24 x 250g", "6 x 1L") are never displayed;
/// only countable pack specs ("24 pcs", "6 x pack") are shown.
export function showColisage(colisage: string | null | undefined): boolean {
  if (!colisage) return false;
  const words = colisage.toLowerCase().split(/[^a-z\u0600-\u06FF]+/).filter(Boolean);
  return words.some((w) => COUNTABLE_WORDS.includes(w));
}

/// Auto-linked pack info: colisage + "1 carton = 50 pièce" + pack barcode.
export function PackInfo({
  product,
  unitId,
}: {
  product: UnitAwareProduct | undefined;
  unitId: string;
}) {
  if (!product) return null;
  const raw = product.conversions.find((c) => c.unitId === unitId);
  const uname = unitNameOf(product, unitId, "");
  const showCol = showColisage(product.colisage);
  // Pack/base selected: show what it holds ("1 كرتون = 36 قطعة").
  const piece =
    !raw || normFactor(raw.factor) >= 1
      ? product.conversions.filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0]
      : undefined;
  // Level-respecting equivalence for the selected pack ("1 منصة = 30 فاردو").
  const packsAsc = product.conversions
    .filter((c) => c.factor > 1)
    .sort((a, b) => a.factor - b.factor)
    .map((c) => ({ unitId: c.unitId, name: unitNameOf(product, c.unitId, ""), factor: normFactor(c.factor) }));
  const rawIdx = raw ? packsAsc.findIndex((c) => c.unitId === unitId) : -1;
  const rawLabel =
    raw && uname
      ? rawIdx >= 0
        ? levelLabel(packsAsc, rawIdx, baseNameOf(product))
        : describePack(uname, raw.factor, baseNameOf(product))
      : null;
  // Dedupe: when structured conversions exist the computed equivalence
  // ("1 كرتون = 24 قطعة") always wins — the free-text colisage ("كرتون 24")
  // only shows as fallback when there is nothing to compute.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const shown: string[] = [];
  if (rawLabel) shown.push(rawLabel);
  else if (showCol && product.colisage?.trim()) shown.push(product.colisage.trim());
  void norm;
  if (shown.length === 0 && !piece) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] font-bold text-(--brand-600)">
      {shown.map((s, idx) => (
        <bdi key={idx}>{s}</bdi>
      ))}
      {!raw && piece && (
        <bdi>
          1 {uname || baseNameOf(product)} = {Math.round(1 / normFactor(piece.factor))} {piece.unit?.name ?? ""}
        </bdi>
      )}
      {raw && normFactor(raw.factor) >= 1 && piece && (
        <bdi>
          1 {baseNameOf(product)} = {Math.round(1 / normFactor(piece.factor))} {piece.unit?.name ?? ""}
        </bdi>
      )}
      {(raw?.barcode || piece?.barcode) && (
        <span className="font-mono opacity-80" dir="ltr">{raw?.barcode ?? piece?.barcode}</span>
      )}
    </div>
  );
}

/// Exact factor: sub-base units (1 piece = 1/N base) normalize to exact 1/N
/// so piece math never drifts on the rounded 0.042-style stored factor.
export function normFactor(f: number): number {
  if (!(f > 0)) return 1;
  return f < 1 ? 1 / Math.round(1 / f) : f;
}

/// How many base units one chosen unit holds (1 when base / unknown).
/// Normalized: piece factors (0.042…) become exact 1/N.
export function factorOf(p: UnitAwareProduct | undefined, unitId: string): number {
  if (!p || !unitId || unitId === p.baseUnitId) return 1;
  return normFactor(p.conversions.find((c) => c.unitId === unitId)?.factor ?? 1);
}

/// Fair price of one chosen unit given the per-base price.
export function priceForUnit(basePrice: number, factor: number): number {
  return basePrice * normFactor(factor);
}

export type SaleUnitOpt = { id: string; name: string };
/// Saleable units: when packs exist, pieces are excluded — carton goods
/// sell by whole cartons (or bigger packs) only, never loose pieces.
export function saleUnits(
  p: (UnitAwareProduct & { baseUnit?: { id: string; name: string } | null }) | undefined,
  allowPieces = false
): SaleUnitOpt[] {
  if (!p) return [];
  const convs = p.conversions.filter((c) => c.unitId && c.factor > 0);
  if (allowPieces) {
    return [
      ...(p.baseUnitId ? [{ id: p.baseUnitId, name: p.baseUnit?.name ?? "—" }] : []),
      ...convs.map((c) => ({ id: c.unitId, name: c.unit?.name ?? c.unitId })),
    ];
  }
  const packsAbove = convs.filter((c) => c.factor > 1);
  const piecesBelow = convs.filter((c) => c.factor < 1);
  const baseOpt: SaleUnitOpt[] = p.baseUnitId
    ? [{ id: p.baseUnitId, name: p.baseUnit?.name ?? "—" }]
    : [];
  if (packsAbove.length === 0 && piecesBelow.length === 0) return baseOpt;
  const baseIsPack = piecesBelow.length > 0;
  const packOpts = packsAbove.map((c) => ({
    id: c.unitId,
    name: c.unit?.name ?? c.unitId,
  }));
  return [...(baseIsPack ? baseOpt : []), ...packOpts];
}

/// Logical pack description in either direction:
/// "1 carton = 50 pièces" or "1 carton = 6 bouteilles" (never "1 pièce = 0.042").
export function describePack(unit: string, factor: number, base: string): string {
  const f = normFactor(factor);
  if (f >= 1) return `1 ${unit} = ${trimNum(f)} ${base}`;
  const n = Math.round(1 / f);
  return `1 ${base} = ${n} ${unit}`;
}

function trimNum(v: number): string {
  // en-US comma grouping is bidi-safe in RTL (space grouping splits runs).
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/// Short pack spec for option labels: base → "36 قطعة", pack → "×50".
export function unitSpec(p: UnitAwareProduct | undefined, unitId: string): string {
  if (!p) return "";
  const isBase = !unitId || unitId === p.baseUnitId;
  if (isBase) {
    const piece = p.conversions.filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0];
    if (!piece) return "";
    return `${Math.round(1 / normFactor(piece.factor))} ${piece.unit?.name ?? ""}`;
  }
  const c = p.conversions.find((x) => x.unitId === unitId);
  if (!c) return "";
  const f = normFactor(c.factor);
  return f >= 1 ? `×${trimNum(f)}` : `${Math.round(1 / f)} ${baseNameOf(p)}`;
}

export function unitNameOf(
  p: UnitAwareProduct | undefined,
  unitId: string,
  fallback: string
): string {
  if (!p) return fallback;
  if (!unitId || unitId === p.baseUnitId) return p.baseUnit?.name ?? fallback;
  const c = p.conversions.find((x) => x.unitId === unitId);
  return c?.unit?.name ?? fallback;
}

export function baseNameOf(p: UnitAwareProduct | undefined, fallback = "—"): string {
  return p?.baseUnit?.name ?? fallback;
}

/// "2 fardeau + 3 cartons + 20 pièces" — stock broken down through every
/// pack level (largest → smallest → base). Single-level products keep the
/// exact legacy output ("6 cartons + 20 pièces" / "N base = M pieces").
export function packBreakdown(
  qty: number,
  conversions: Array<{ unitId: string; factor: number }>,
  unitName: (id: string) => string,
  baseName: string
): string {
  const packs = [...conversions].filter((c) => c.factor > 1).sort((a, b) => b.factor - a.factor);
  const n = qty.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (packs.length === 0) {
    const piece = [...conversions].filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0];
    if (piece) {
      const per = Math.round(1 / piece.factor);
      const total = Math.round(qty * per).toLocaleString("en-US");
      return baseName ? `${n} ${baseName} = ${total} ${unitName(piece.unitId)}` : `${total} ${unitName(piece.unitId)}`;
    }
    return baseName ? `${n} ${baseName}` : n;
  }
  let rest = Math.round(qty * 1000) / 1000;
  const parts: string[] = [];
  for (const pack of packs) {
    const count = Math.floor(rest / pack.factor + 1e-9);
    if (count > 0) {
      parts.push(`${count.toLocaleString("en-US")} ${unitName(pack.unitId)}`);
      rest = Math.round((rest - count * pack.factor) * 1000) / 1000;
    }
  }
  // Empty stock with colisage: show in sale colis ("0 CARTON"), not base pieces.
  if (parts.length === 0 && !(rest > 0) && packs.length > 0) {
    const l1 = packs[packs.length - 1];
    return `0 ${unitName(l1.unitId)}`;
  }
  if (rest > 0 || parts.length === 0) {
    parts.push(`${rest.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${baseName}`);
  }
  return parts.join(" + ");
}

/// "2 carton = 100 pièce" — shown under qty inputs when a pack unit is used.
export function UnitQty({
  qty,
  factor,
  baseName,
  product,
}: {
  qty: number;
  factor: number;
  baseName: string;
  product?: UnitAwareProduct;
}) {
  if (!factor || !(qty > 0)) return null;
  // Base unit selected but pieces exist below → live piece total.
  if (factor === 1 && product) {
    const piece = product.conversions.filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0];
    if (!piece) return null;
    const per = Math.round(1 / normFactor(piece.factor));
    return (
      <div className="mt-0.5 text-[11px] font-black text-(--brand-600)">
        = {(qty * per).toLocaleString("en-US")} {unitNameOf(product, piece.unitId, "")}
      </div>
    );
  }
  if (factor === 1) return null;
  return (
    <div className="mt-0.5 text-[11px] font-black text-(--brand-600)">
      = {(qty * factor).toLocaleString("en-US", { maximumFractionDigits: 2 })} {baseName}
    </div>
  );
}
