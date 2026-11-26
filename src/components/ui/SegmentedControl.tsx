"use client";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/motion";

/// Khiata-style segmented control: bordered tray, active option is a raised
/// surface tile (not a brand fill) — quieter than the old brand-fill pills.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="gw-seg flex w-full gap-1 rounded-[11px] border border-(--border-default) bg-(--bg-surface) p-1"
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--n": options.length, "--i": Math.max(0, options.findIndex((o) => o.value === value)) } as React.CSSProperties}
    >
      <span aria-hidden className="gw-seg-pill" />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => { if (!active) haptic("select"); onChange(o.value); }}
            className={cn(
              "relative z-[1] min-h-9 flex-1 rounded-[8px] px-2 text-[12px] transition-colors",
              active
                ? "font-black text-(--text-primary)"
                : "font-bold text-(--text-secondary) hover:text-(--text-primary)"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
