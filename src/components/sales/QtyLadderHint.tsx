"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dzMoney } from "@/lib/format";
import { ladderLine, type LadderProduct } from "@/lib/pricing";
import { LADDER_TONES } from "@/components/products/QtyLadder";

/// Under a sale line: which quantity range the line is in (coloured chip that
/// pops when it changes), a progress bar to the next cheaper range and a tap
/// target that jumps to the quantity that unlocks it. Renders nothing when the
/// product has no ladder for the line's unit.
export function QtyLadderHint({
  product, unitId, qty, fallbackTierId, tierName, onJump, className,
}: {
  product: LadderProduct;
  unitId: string | null | undefined;
  qty: number;
  fallbackTierId: string | null;
  tierName: (id: string | null) => string;
  onJump?: (qty: number) => void;
  className?: string;
}) {
  const t = useTranslations("products");
  const r = ladderLine(product, unitId, qty, fallbackTierId);
  if (!r.hasLadder || !(qty > 0)) return null;
  const color = LADDER_TONES[(r.pick?.index ?? 0) % LADDER_TONES.length];
  const cur = r.pick?.rung.minQty ?? 0;
  const nextMin = r.hint?.atQty ?? r.pick?.next?.minQty;
  const next = nextMin != null ? { minQty: nextMin } : null;
  const prog = next && next.minQty > cur ? Math.min(1, Math.max(0, (qty - cur) / (next.minQty - cur))) : 1;
  return (
    <div className={cn("mt-2 rounded-xl bg-(--bg-sunken) px-2.5 py-2", className)} dir="auto">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* key = tier → the chip re-mounts and pops on every range change */}
        <span key={`${r.pick?.index ?? -1}`} className="gw-bump rounded-full px-2.5 py-0.5 text-[11px] font-black text-white" style={{ background: color }}>
          {tierName(r.tierId)}
        </span>
        <span className="text-[11px] font-black tabular-nums text-(--text-secondary)" dir="ltr">{dzMoney(r.unitPrice)}</span>
        {r.hint && (
          <button
            type="button"
            onClick={() => onJump?.(r.hint!.atQty)}
            className="ms-auto flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-black text-(--brand-600) hover:bg-(--brand-500)/10"
          >
            <ArrowUpRight size={13} className="shrink-0" />
            <span className="text-start">{t("ladderUnlock", { n: r.hint.missing, tier: tierName(r.hint.tierId), pct: r.hint.pct })}</span>
          </button>
        )}
      </div>
      {next && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--border-default)">
          <div className="h-full rounded-full" style={{ width: `${prog * 100}%`, background: color, transition: "width 0.45s cubic-bezier(0.34,1.56,0.64,1)" }} />
        </div>
      )}
    </div>
  );
}
