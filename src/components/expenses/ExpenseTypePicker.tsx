"use client";

import { Bus, Check, CircleDot, Droplets, Fuel, Gavel, BedDouble, ParkingSquare, Phone, Receipt, Utensils, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/motion";

export type ExpenseTypeOpt = { id: string; name: string };

type Style = { Icon: LucideIcon; tone: string };

/// Icon + colour per expense type, guessed from the name (fr / ar / en) so
/// every company's own types still look intentional. Unknown names get a
/// stable colour from a hash of the name.
const RULES: Array<[RegExp, Style]> = [
  [/(fuel|essence|carburant|gasoil|gazole|mazout|diesel|gaz\b|وقود|بنزين|مازوت|مازوت|غازوال)/, { Icon: Fuel, tone: "#f59e0b" }],
  [/(repas|manger|restaur|food|nourriture|casse.?croute|أكل|اكل|وجبة|طعام|مطعم)/, { Icon: Utensils, tone: "#f97316" }],
  [/(repar|entretien|maintenance|garage|mecani|vidange|صيانة|تصليح|إصلاح|اصلاح|ميكانيك|زيت)/, { Icon: Wrench, tone: "#0ea5e9" }],
  [/(peage|autoroute|parking|stationnement|موقف|ركن|رسوم)/, { Icon: ParkingSquare, tone: "#8b5cf6" }],
  [/(lavage|wash|nettoyage|غسيل|تنظيف)/, { Icon: Droplets, tone: "#06b6d4" }],
  [/(pneu|roue|tire|crevaison|عجلة|إطار|اطار|كاوتشو)/, { Icon: CircleDot, tone: "#64748b" }],
  [/(amende|contravention|\bpv\b|fine|غرامة|مخالفة)/, { Icon: Gavel, tone: "#ef4444" }],
  [/(phone|telephone|tel\b|credit|recharge|flexy|هاتف|رصيد|تعبئة)/, { Icon: Phone, tone: "#10b981" }],
  [/(hotel|logement|nuit|hebergement|فندق|مبيت|إقامة)/, { Icon: BedDouble, tone: "#6366f1" }],
  [/(transport|taxi|bus|train|نقل|حافلة)/, { Icon: Bus, tone: "#14b8a6" }],
];
const FALLBACK_TONES = ["#ec4899", "#84cc16", "#eab308", "#a855f7", "#22d3ee", "#fb7185"];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function expenseTypeStyle(name: string): Style {
  const n = norm(name);
  for (const [re, st] of RULES) if (re.test(n)) return st;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return { Icon: Receipt, tone: FALLBACK_TONES[h % FALLBACK_TONES.length] };
}

/// Required expense-type buttons: big tappable tiles with a coloured icon,
/// spring pop on select, check badge and a staggered entrance.
export function ExpenseTypePicker({
  types, value, onChange, label, required, emptyText, compact,
}: {
  types: ExpenseTypeOpt[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  required?: boolean;
  emptyText: string;
  compact?: boolean;
}) {
  return (
    <div>
      {label && (
        <div className="mb-2 flex items-center gap-1 text-xs font-bold uppercase opacity-70">
          {label}{required && <span className="text-red-500">*</span>}
        </div>
      )}
      {types.length === 0 ? (
        <p className="rounded-xl border border-dashed border-(--border-default) p-4 text-center text-xs font-bold opacity-70">{emptyText}</p>
      ) : (
        <div role="radiogroup" aria-label={label} className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
          {types.map((ty, i) => {
            const sel = ty.id === value;
            const { Icon, tone } = expenseTypeStyle(ty.name);
            return (
              <button
                key={ty.id}
                type="button"
                role="radio"
                aria-checked={sel}
                data-no-ripple
                onClick={() => { haptic(sel ? "tap" : "select"); onChange(ty.id); }}
                className={cn(
                  "gw-rise relative flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 px-2 text-center outline-none transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] active:scale-95 focus-visible:ring-2 focus-visible:ring-(--brand-500)",
                  compact ? "min-h-[68px] py-2" : "min-h-[88px] py-3",
                  sel ? "scale-[1.04]" : "bg-(--bg-surface) hover:-translate-y-0.5"
                )}
                style={{
                  animationDelay: `${Math.min(i, 11) * 45}ms`,
                  borderColor: sel ? tone : "var(--border-default)",
                  background: sel ? `linear-gradient(160deg, ${tone}38, ${tone}0f)` : undefined,
                  boxShadow: sel ? `0 12px 26px -12px ${tone}` : undefined,
                }}
              >
                <span
                  className={cn("flex items-center justify-center rounded-xl transition-all duration-300", compact ? "h-8 w-8" : "h-10 w-10", sel && "gw-bump")}
                  style={{ background: sel ? tone : `${tone}22`, color: sel ? "#fff" : tone }}
                >
                  <Icon size={compact ? 16 : 20} />
                </span>
                <span className={cn("line-clamp-2 font-black leading-tight", compact ? "text-[11px]" : "text-xs")} dir="auto">{ty.name}</span>
                <span
                  aria-hidden
                  className={cn("absolute -top-1.5 end-2 flex h-5 w-5 items-center justify-center rounded-full text-white shadow transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]", sel ? "scale-100" : "scale-0")}
                  style={{ background: tone }}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
