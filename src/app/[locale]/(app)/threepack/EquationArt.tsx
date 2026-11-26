import { ArrowRight, Gift, Package, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/// Abstract "product" tile for the rule illustrations (type cards, empty state):
/// neutral for what the client buys, green with a gift glyph for what is free.
export function MiniTile({ qty, gift, size = "md" }: { qty: string; gift?: boolean; size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-2xl border",
        lg ? "h-16 w-16" : "h-12 w-12",
        gift ? "border-(--semantic-success)/50 bg-(--semantic-success)/10 text-(--semantic-success)" : "border-(--border-default) bg-(--bg-sunken) text-(--text-tertiary)",
      )}
      aria-hidden
    >
      {gift ? <Gift size={lg ? 28 : 21} /> : <Package size={lg ? 28 : 21} />}
      <span
        dir="ltr"
        className={cn(
          "absolute -bottom-2 -end-2 rounded-full px-2 font-black leading-5 shadow-sm",
          lg ? "text-xs" : "text-[11px]",
          gift ? "bg-(--semantic-success) text-white" : "bg-gradient-brand text-(--brand-contrast)",
        )}
      >
        {qty}
      </span>
    </span>
  );
}

export function EqArrow({ size = 14 }: { size?: number }) {
  return <ArrowRight size={size} className="shrink-0 text-(--gold-text) rtl:rotate-180" aria-hidden />;
}

export function EqPlus({ size = 12 }: { size?: number }) {
  return <Plus size={size} className="shrink-0 text-(--text-tertiary)" aria-hidden />;
}
