"use client";

import { ArrowRight, Gift, Pencil, Plus, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/Toggle";
import { ProductThumb } from "@/components/threepack/ProductPicker";
import { cn } from "@/lib/utils";
import { dzMoney } from "@/lib/format";
import { windowState, daysLeft, toYmd } from "@/lib/threepack/window";
import type { Rule, RuleItem } from "./types";

/// One product in the equation: photo, quantity badge, name. Gift tiles get a
/// green ring and a gift badge so "what the client pays for" and "what is free"
/// read apart at a glance.
function Tile({ item, gift, dim, deal }: { item: RuleItem; gift?: boolean; dim?: boolean; deal?: string }) {
  const qty = deal ?? `×${item.colis}`;
  return (
    <div className="flex w-[4.75rem] flex-col items-center gap-1.5 text-center">
      <div className="relative">
        <ProductThumb
          src={item.imageUrl}
          name={item.productName}
          size={64}
          className={cn("rounded-2xl transition-[filter,opacity] duration-200", gift && "ring-2 ring-(--semantic-success)/55", deal && "ring-2 ring-amber-500/60", dim && "opacity-60 grayscale")}
        />
        <span
          dir="ltr"
          className={cn(
            "absolute -bottom-2 -end-2 rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums leading-tight shadow-sm",
            gift ? "bg-(--semantic-success) text-white" : deal ? "bg-amber-500 text-white" : "bg-gradient-brand text-(--brand-contrast)",
          )}
        >
          {qty}
        </span>
        {deal && (
          <span className="absolute -start-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm" aria-hidden>
            <Tag size={11} />
          </span>
        )}
        {gift && (
          <span className="absolute -start-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-(--semantic-success) text-white shadow-sm" aria-hidden>
            <Gift size={11} />
          </span>
        )}
      </div>
      <span className="mt-1 line-clamp-2 text-[11px] font-bold leading-snug">{item.productName}</span>
    </div>
  );
}

/// A rule drawn as the sum it is: [photos bought] → [free photos].
export function RuleCard({ rule, onToggle, onEdit, flash }: { rule: Rule; onToggle: (v: boolean) => void; onEdit: () => void; flash?: boolean }) {
  const t = useTranslations("threepack");
  const buys = rule.items.filter((i) => i.role === "BUY");
  const gives = rule.items.filter((i) => i.role === "GIVE");
  const win = windowState(rule);
  const left = daysLeft(rule.endsAt);
  const off = !rule.isActive || win === "expired";
  const isPercent = rule.mode === "PERCENT";
  const isPrice = rule.mode === "PRICE";
  const isDeal = isPercent || isPrice;
  const dealBadge = (it: RuleItem) => (isPercent ? `−${rule.percent ?? 0}%` : `${dzMoney(it.price ?? 0)}`);
  return (
    <article
      style={flash ? { animation: "gw-glow 1.1s ease-out 3" } : undefined}
      className={cn(
        "flex flex-col gap-5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-(--card-shadow) transition-shadow duration-200 hover:shadow-(--card-shadow-hover) sm:p-5",
        off && "bg-(--bg-surface)",
        flash && "border-(--brand-500)",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("truncate text-base font-black", off && "text-(--text-secondary)")}>{rule.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-(--bg-sunken) px-2.5 py-0.5 text-[11px] font-bold text-(--text-secondary)">
              {rule.mode === "SINGLE" ? t("modeSingle") : rule.mode === "PACK" ? t("modePack") : isPercent ? t("modePercent") : t("modePrice")}
            </span>
            {off && win !== "expired" && <span className="rounded-full bg-(--bg-sunken) px-2.5 py-0.5 text-[11px] font-bold text-(--text-tertiary)">{t("inactive")}</span>}
            {win === "expired" && <span className="rounded-full bg-(--semantic-danger)/10 px-2.5 py-0.5 text-[11px] font-black text-(--semantic-danger)">{t("stateExpired")}</span>}
            {win === "scheduled" && <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-black text-amber-600">{t("stateScheduled")}</span>}
            {win === "live" && rule.isActive && left != null && left <= 3 && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-black text-amber-600">{left === 0 ? t("endsToday") : t("daysLeft", { n: String(left) })}</span>
            )}
            {(rule.startsAt || rule.endsAt) && (
              <span className="rounded-full bg-(--bg-sunken) px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-(--text-secondary)" dir="ltr">
                📅 {rule.startsAt ? toYmd(rule.startsAt) : "…"} → {rule.endsAt ? toYmd(rule.endsAt) : "∞"}
              </span>
            )}
          </div>
        </div>
        {win !== "expired" && <Switch checked={rule.isActive} onChange={onToggle} label={rule.isActive ? t("active") : t("inactive")} />}
      </header>

      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-5 pb-1">
        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-5">
          {buys.map((it, i) => (
            <div key={it.id ?? it.productId} className="flex items-start gap-1.5">
              {i > 0 && <Plus size={14} className="mt-7 shrink-0 text-(--text-tertiary)" aria-hidden />}
              <Tile item={it} dim={off} />
            </div>
          ))}
        </div>
        <span className={cn("mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", off ? "bg-(--bg-sunken) text-(--text-tertiary)" : "bg-gradient-brand text-(--brand-contrast)")} aria-hidden>
          <ArrowRight size={16} className="rtl:rotate-180" />
        </span>
        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-5">
          {gives.map((it, i) => (
            <div key={it.id ?? it.productId} className="flex items-start gap-1.5">
              {i > 0 && <Plus size={14} className="mt-7 shrink-0 text-(--text-tertiary)" aria-hidden />}
              <Tile item={it} gift={!isDeal} deal={isDeal ? dealBadge(it) : undefined} dim={off} />
            </div>
          ))}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-(--border-subtle) pt-3">
        {isDeal ? (
          <p className="flex min-w-0 items-center gap-2 text-xs font-bold text-amber-600">
            <Tag size={14} className="shrink-0" aria-hidden />
            <span className="truncate">{isPrice ? t("dealAutoPrice") : t("dealAutoPercent")}</span>
          </p>
        ) : (
          <p className={cn("flex min-w-0 items-center gap-2 text-xs font-bold", rule.givenColis > 0 ? "text-(--semantic-success)" : "text-(--text-tertiary)")}>
            <Gift size={14} className="shrink-0" aria-hidden />
            <span className="truncate">{rule.givenColis > 0 ? t("givenCount", { n: String(rule.givenColis) }) : t("givenNone")}</span>
          </p>
        )}
        <button type="button" onClick={onEdit} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-(--text-secondary) transition-colors hover:bg-(--bg-sunken) hover:text-(--text-primary)">
          <Pencil size={14} aria-hidden />
          {t("editRule")}
        </button>
      </footer>
    </article>
  );
}
