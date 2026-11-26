"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const num = (s: string) => Number(String(s).replace(",", "."));

/// Big, thumb-friendly colis quantity: − [ 10 ] + with the unit label. Typing
/// accepts decimals (e.g. 0.5 colis); the buttons step by whole colis.
export function QtyStepper({
  value,
  onChange,
  label,
  unit,
  invalid,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  unit: string;
  invalid?: boolean;
  className?: string;
}) {
  const n = num(value);
  const base = Number.isFinite(n) && n > 0 ? n : 0;
  const bump = (d: 1 | -1) => onChange(String(d > 0 ? Math.round((base + 1) * 1000) / 1000 : base > 1 ? Math.max(1, Math.round((base - 1) * 1000) / 1000) : base));
  const btn = "flex h-full w-11 shrink-0 items-center justify-center text-(--text-secondary) transition-colors hover:bg-(--bg-sunken) active:bg-(--border-subtle) disabled:opacity-40";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex h-16 shrink-0 items-stretch overflow-hidden rounded-2xl border bg-(--bg-surface) transition-[border-color,box-shadow] duration-150 focus-within:border-(--brand-500) focus-within:shadow-(--focus-ring)",
        invalid ? "border-(--semantic-danger)" : "border-(--border-default)",
        className,
      )}
    >
      <button type="button" onClick={() => bump(-1)} aria-label="−" disabled={base <= 1} className={btn}>
        <Minus size={16} />
      </button>
      <span className="flex min-w-0 flex-1 flex-col items-center justify-center px-1 sm:flex-none">
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
          aria-label={label}
          placeholder="0"
          className="h-11 w-16 bg-transparent text-center text-xl font-black tabular-nums leading-none outline-none placeholder:text-(--text-tertiary)"
        />
        <span className="mt-1 text-[11px] font-bold leading-none text-(--text-secondary)">{unit}</span>
      </span>
      <button type="button" onClick={() => bump(1)} aria-label="+" className={btn}>
        <Plus size={16} />
      </button>
    </div>
  );
}
