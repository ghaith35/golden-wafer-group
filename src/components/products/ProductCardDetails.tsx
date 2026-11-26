"use client";

import { packBreakdown, priceForUnit, showColisage } from "./UnitQty";
import { dz, dzMoney } from "@/lib/format";
import { levelLabel } from "@/lib/products/colisage";

export type LadderTier = { name: string; price: number };
export type LadderConv = { unitId: string; factor: number; unitName: string };
export type CumpInfo = { qty: number; cump: number; value: number };

const num = (v: number) => dz(v);
const money = (v: number) => dzMoney(v);

/// Grossiste detail block for product cards: stock breakdown, price ladder
/// (achat / vente / tiers / pack equivalents), CUMP + stock value.
export function ProductCardDetails({
  stockQty,
  depotQty = null,
  depotLabel = "",
  vanQty = null,
  vanLabel = "",
  costPrice,
  salePrice,
  tiers,
  conversions,
  baseName,
  cump,
  costLabel,
  saleLabel,
  cumpLabel,
  valueLabel,
  marginLabel,
  compact,
  showBase = true,
  showStock = true,
  colisage,
}: {
  stockQty: number;
  /// Depot-only remainder (transfers leave the global total unchanged).
  depotQty?: number | null;
  depotLabel?: string;
  /// All vans combined. When both are provided the card shows per-location
  /// lines INSTEAD of the global breakdown (never both = no double info).
  vanQty?: number | null;
  vanLabel?: string;
  costPrice: number;
  salePrice: number;
  tiers: LadderTier[];
  conversions: LadderConv[];
  baseName: string;
  cump?: CumpInfo | null;
  costLabel: string;
  saleLabel: string;
  cumpLabel: string;
  valueLabel: string;
  marginLabel: string;
  compact?: boolean;
  showBase?: boolean;
  showStock?: boolean;
  colisage?: string | null;
}) {
  const unitName = (id: string) => conversions.find((c) => c.unitId === id)?.unitName ?? "";
  /// Packs above base, smallest first (L1 = sale colis). Prices are shown
  /// per L1 so they stay whole per colis — per-base fractions (0.33/0.5…)
  /// are never displayed for colis products.
  const packsAsc = [...conversions].filter((c) => c.factor > 1).sort((a, b) => a.factor - b.factor);
  const l1 = packsAsc[0] ?? null;
  const colisPrice = (base: number) => (l1 ? priceForUnit(base, l1.factor) : base);
  const priceSuffix = l1 ? ` / ${unitName(l1.unitId)}` : "";
  /// Static pack equivalences ("1 كرتون = 24 حبة") — product info, not stock.
  /// Rendered even when the stock block is hidden (POS cards), otherwise the
  /// colisage definition is invisible where sellers need it most.
  const levelsAsc = packsAsc.map((c) => ({ name: unitName(c.unitId), factor: c.factor }));
  const pieceBelow =
    packsAsc.length === 0
      ? [...conversions].filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0] ?? null
      : null;
  const equivalence: string[] =
    pieceBelow != null
      ? [`1 ${baseName} = ${num(Math.round(1 / pieceBelow.factor))} ${pieceBelow.unitName}`]
      : levelsAsc.map((_, i) => levelLabel(levelsAsc, levelsAsc.length - 1 - i, baseName));
  return (
    <div className="space-y-1">
      {showStock && depotQty != null && vanQty != null && (
        <div className="text-(--brand-600)">
          {equivalence.map((line) => (
            <div key={line} className="break-words text-[11px] font-bold opacity-80">
              <bdi>{line}</bdi>
            </div>
          ))}
          <div className="break-words text-[11px] font-black">
            🏭 {depotLabel}: {packBreakdown(depotQty, conversions, unitName, baseName)}
          </div>
          {vanQty > 0 && (
            <div className="break-words text-[11px] font-black">
              🚚 {vanLabel}: {packBreakdown(vanQty, conversions, unitName, baseName)}
            </div>
          )}
        </div>
      )}
      {showStock && (depotQty == null || vanQty == null) && (
        <div className="text-(--brand-600)">
          {(() => {
            // Base IS the pack (carton): piece conversion has factor < 1.
            const piece = packsAsc.length === 0 ? [...conversions].filter((c) => c.factor < 1).sort((a, b) => a.factor - b.factor)[0] : null;
            if (piece) {
              const per = Math.round(1 / piece.factor);
              return (
                <>
                  <div className="break-words text-sm font-black">
                    {num(stockQty)} {baseName}
                  </div>
                  <div className="break-words text-[11px] font-bold opacity-80">
                    1 {baseName} = {num(per)} {piece.unitName}
                  </div>
                  <div className="break-words text-[11px] font-bold opacity-80">
                    {num(Math.round(stockQty * per))} {piece.unitName}
                  </div>
                </>
              );
            }
            if (packsAsc.length === 0) {
              return (
                <>
                  <div className="break-words text-[11px] font-black">
                    {num(stockQty)}{baseName ? ` ${baseName}` : ""}
                  </div>
                  {showColisage(colisage) && (
                    <div className="break-words text-[11px] font-bold opacity-80">📦 {colisage}</div>
                  )}
                </>
              );
            }
            // Nested whole-colis breakdown: "1 منصة + 20 فاردو" (never "1.67 منصة").
            // Equivalences respect levels: "1 منصة = 30 فاردو", "1 فاردو = 6 علبة".
            const levels = packsAsc.map((c) => ({ name: unitName(c.unitId), factor: c.factor }));
            return (
              <>
                <div className="break-words text-sm font-black">
                  {packBreakdown(stockQty, conversions, unitName, baseName)}
                </div>
                {levels.map((_, i) => (
                  <div key={packsAsc[levels.length - 1 - i].unitId} className="break-words text-[11px] font-bold opacity-80">
                    {levelLabel(levels, levels.length - 1 - i, baseName)}
                  </div>
                ))}
                {/* The breakdown already says "0 قطعة" when empty — don't repeat it. */}
                {stockQty > 0 && (
                  <div className="break-words text-[11px] font-bold opacity-80">
                    {num(stockQty)} {baseName}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
      {!showStock && equivalence.length > 0 && (
        <div className="text-(--brand-600)">
          {equivalence.map((line) => (
            <div key={line} className="break-words text-[11px] font-bold opacity-80">
              <bdi>{line}</bdi>
            </div>
          ))}
        </div>
      )}
      <div className={`grid grid-cols-2 gap-x-2 gap-y-0.5 ${compact ? "text-[11px]" : "text-xs"}`}>
        {showBase !== false && (
          <>
            <span className="break-words opacity-60">{costLabel}{priceSuffix}</span>
            <span className="text-end font-black tabular-nums" dir="ltr">{money(colisPrice(costPrice))}</span>
            <span className="break-words opacity-60">{saleLabel}{priceSuffix}</span>
            <span className="text-end font-black tabular-nums text-(--brand-600)" dir="ltr">{money(colisPrice(salePrice))}</span>
          </>
        )}
        {tiers.map((x) => (
          <span key={x.name} className="contents">
            <span className="break-words opacity-60">{x.name}{priceSuffix}</span>
            <span className="text-end font-bold tabular-nums" dir="ltr">{money(colisPrice(x.price))}</span>
          </span>
        ))}
      </div>
      {cump && (
        <div className="space-y-0.5 border-t border-(--border-subtle) pt-1 text-[11px] font-bold">
          <div className="flex justify-between gap-2">
            <span className="break-words opacity-60">
              {cumpLabel}{baseName ? ` / ${baseName}` : ""}
            </span>
            <span className="shrink-0 tabular-nums" dir="ltr">{money(cump.cump)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="break-words opacity-60">
              {valueLabel} ({num(cump.qty)}{baseName ? ` ${baseName}` : ""})
            </span>
            <span className="shrink-0 tabular-nums" dir="ltr">{money(cump.value)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="break-words opacity-60">{marginLabel}</span>
            <span className={`shrink-0 tabular-nums ${salePrice - cump.cump >= 0 ? "text-(--brand-600)" : "text-red-500"}`} dir="ltr">
              {money(salePrice - cump.cump)}
              {cump.cump > 0 ? ` (${Math.round(((salePrice - cump.cump) / cump.cump) * 100)}%)` : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
