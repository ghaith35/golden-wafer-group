"use client";

import { useEffect, useMemo, useState } from "react";
import { Gift } from "lucide-react";
import { applyDeals, colisOf, computeBonus, type AppliedDeal, type ColisInfo, type GiftLine, type ThreePackRuleLite } from "@/lib/threepack/match";
import { normFactor } from "@/components/products/UnitQty";

/// Minimal product shape the matcher needs (DocProduct / PosProduct both fit).
export type GiftProduct = {
  id: string;
  name: string;
  baseUnitId: string | null;
  baseUnit?: { id: string; name: string } | null;
  conversions: Array<{ unitId: string; factor: number; unit?: { id?: string; name?: string } | null }>;
  images?: Array<{ url: string }>;
};

export type PurchasedLine = { productId: string; unitId?: string | null; qty: number };

type ServerProd = {
  id: string;
  name: string;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  images: Array<{ url: string }>;
  conversions: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
};
type SnapProd = {
  id: string;
  name: string;
  baseUnit: { id: string; name: string } | null;
  images: string[];
  conversions: Array<{ unitId: string; name: string; factor: number }>;
};

/// Products in the matcher's shape: the server list when present, else the
/// offline snapshot. Call inside `useMemo(..., [products, snap])` — the inputs
/// are stable, unlike a per-render `effProducts` array.
export function giftProductsFrom(products: ServerProd[], snapProducts: SnapProd[] | undefined): GiftProduct[] {
  if (products.length > 0) {
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      baseUnitId: p.baseUnitId,
      baseUnit: p.baseUnit,
      images: p.images,
      conversions: p.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor), unit: c.unit })),
    }));
  }
  return (snapProducts ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    baseUnitId: p.baseUnit?.id ?? null,
    baseUnit: p.baseUnit,
    images: p.images.map((url) => ({ url })),
    conversions: p.conversions.map((c) => ({ unitId: c.unitId, factor: c.factor, unit: { name: c.name } })),
  }));
}

/// Active 3pack rules for the web forms. Online: fetched from the server (so a
/// rule edited a minute ago is live). Offline / fetch failed: the van snapshot's
/// copy. `null` while unknown. The server recomputes on save regardless.
export function useThreePackRules(
  snap: { threePack?: { enabled: boolean; rules: ThreePackRuleLite[] } } | null | undefined,
  online: boolean,
): ThreePackRuleLite[] {
  const [fetched, setFetched] = useState<ThreePackRuleLite[] | null>(null);
  useEffect(() => {
    if (!online) return;
    let live = true;
    fetch("/api/threepack/active", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d && Array.isArray(d.rules)) setFetched(d.rules as ThreePackRuleLite[]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [online]);
  return useMemo(() => {
    if (online && fetched) return fetched;
    return snap?.threePack?.enabled ? snap.threePack.rules : [];
  }, [online, fetched, snap]);
}

/// Colis info (unit + base units per colis) per product, from the form's own
/// product list — works identically online and from the offline snapshot.
export function colisMap(products: GiftProduct[]): Record<string, ColisInfo | undefined> {
  const out: Record<string, ColisInfo | undefined> = {};
  for (const p of products) {
    out[p.id] = colisOf({ baseUnitId: p.baseUnitId ?? p.baseUnit?.id ?? null, conversions: p.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) })) }) ?? undefined;
  }
  return out;
}

/// A line's quantity in BASE units (qty × its unit's factor), from the same
/// product data the matcher uses — the single source for the form and its guard.
export function lineBaseQty(products: GiftProduct[], l: PurchasedLine): number {
  const p = products.find((x) => x.id === l.productId);
  const base = p ? (p.baseUnitId ?? p.baseUnit?.id) : undefined;
  const f = !p || !l.unitId || l.unitId === base ? 1 : normFactor(p.conversions.find((c) => c.unitId === l.unitId)?.factor ?? 1);
  return l.qty * f;
}

/// The gift owed for the cart. Pure function of the purchased lines, recomputed
/// on every change — gift rows are derived, never stored in the form's state.
export function useGifts(rules: ThreePackRuleLite[], products: GiftProduct[], lines: PurchasedLine[]): GiftLine[] {
  const colis = useMemo(() => colisMap(products), [products]);
  return useMemo(() => {
    if (rules.length === 0) return [];
    const bought = lines.filter((l) => l.productId && l.qty > 0).map((l) => ({ productId: l.productId, baseQty: lineBaseQty(products, l) }));
    return computeBonus(rules, bought, colis);
  }, [rules, products, lines, colis]);
}

/// A cart line after the price deals (% off / new price). `origPrice` is the
/// price before the deal, `deal` says which rule changed it (undefined = none).
export type DealtLine<L> = L & { origPrice: number; deal?: AppliedDeal };

/// Re-price the cart with the active PERCENT / PRICE rules — the same pure
/// function the server uses, so an offline sale is priced exactly as the PC
/// would price it. `enabled=false` (e.g. editing a saved ticket whose prices are
/// already final) returns the lines untouched.
export function useDealLines<L extends { productId: string; unitId?: string | null; qty: number; unitPrice: number }>(
  rules: ThreePackRuleLite[],
  products: GiftProduct[],
  lines: L[],
  enabled = true,
): Array<DealtLine<L>> {
  const colis = useMemo(() => colisMap(products), [products]);
  return useMemo(() => {
    const plain = lines.map((l) => ({ ...l, origPrice: l.unitPrice })) as Array<DealtLine<L>>;
    if (!enabled || rules.length === 0 || lines.length === 0) return plain;
    const dl = lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      baseQty: lineBaseQty(products, l),
      unitPrice: l.unitPrice,
      remise: 0,
      lineTotal: l.qty * l.unitPrice,
    }));
    const out = applyDeals(rules, dl, colis);
    return lines.map((l, i) => ({ ...l, origPrice: l.unitPrice, unitPrice: out[i].unitPrice, deal: (out[i] as { deal?: AppliedDeal }).deal })) as Array<DealtLine<L>>;
  }, [rules, products, lines, colis, enabled]);
}

/// Small chip under a re-priced line: "−20%" or the new price.
export function DealChip({ deal, money }: { deal: AppliedDeal | undefined; money?: string }) {
  if (!deal) return null;
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-black text-amber-700" dir="ltr">
      🏷 {deal.kind === "PERCENT" ? `−${deal.percent}%` : money ?? ""}
    </span>
  );
}

/// Body lines for the gift (price 0, flagged with the rule). The server drops
/// and recomputes them online; the offline outbox keeps them (capped at sync).
export function giftBodyLines(gifts: GiftLine[]) {
  return gifts.map((g) => ({ productId: g.productId, unitId: g.unitId, qty: g.colis, unitPrice: 0, remise: 0, bonusRuleId: g.ruleId }));
}

/// Read-only gift row shown under the purchased lines: quantity in colis,
/// price 0, "FREE" badge. No inputs — change the purchases to change the gift.
export function GiftLineRow({
  gift,
  product,
  freeLabel,
  money,
}: {
  gift: GiftLine;
  product: GiftProduct | undefined;
  freeLabel: string;
  money: string;
}) {
  const unitName =
    (gift.unitId && gift.unitId !== (product?.baseUnitId ?? product?.baseUnit?.id)
      ? product?.conversions.find((c) => c.unitId === gift.unitId)?.unit?.name
      : product?.baseUnit?.name) ?? "";
  const img = product?.images?.[0]?.url;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3" data-testid="gift-line">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-(--bg-sunken)">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={product?.name ?? ""} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-emerald-600"><Gift size={20} /></div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black">{product?.name ?? "—"}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs font-bold text-emerald-700">
          <bdi className="tabular-nums">{gift.colis} {unitName}</bdi>
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">{freeLabel}</span>
        </div>
      </div>
      <div className="shrink-0 text-sm font-black tabular-nums text-emerald-700" dir="ltr">{money}</div>
    </div>
  );
}
