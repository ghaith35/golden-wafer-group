"use client";

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/motion";

/// Bare switch track (Khiata Toggle): for SettingRow control columns.
/// The full label+hint row button below stays for standalone uses.
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => { haptic("select"); onChange(!checked); }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:inset-x-0 before:-inset-y-2.5 disabled:opacity-60",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-500)",
        checked ? "bg-(--brand-500)" : "bg-(--border-strong)"
      )}
    >
      <span
        className={cn(
          "inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          checked ? "translate-x-[23px] rtl:-translate-x-[23px]" : "translate-x-[3px] rtl:-translate-x-[3px]"
        )}
      />
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => { haptic("select"); onChange(!checked); }}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-4 py-3 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-500)"
    >
      <span>
        <span className="block text-sm font-bold">{label}</span>
        {hint && <span className="block text-xs opacity-60">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-(--brand-500)" : "bg-(--border-strong)"
        )}
      >
        <span
          className={cn(
            "inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
            checked ? "translate-x-[23px] rtl:-translate-x-[23px]" : "translate-x-[3px] rtl:-translate-x-[3px]"
          )}
        />
      </span>
    </button>
  );
}
