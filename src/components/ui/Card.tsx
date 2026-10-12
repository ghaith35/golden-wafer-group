import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4", className)} {...props} />;
}

export function KpiCard({
  label,
  value,
  icon,
  accent,
  className,
  valueClassName,
  title,
  compact = false,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: string;
  className?: string;
  valueClassName?: string;
  title?: string;
  /// Compact strip variant for section headers: smaller tile + value.
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div title={title} className={cn("flex items-center gap-2.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5", className)}>
        {icon && (
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", accent ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold text-(--text-tertiary)">{label}</div>
          <div className={cn("truncate text-base font-black tabular-nums", valueClassName)}>{value}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5", className)}>
      {icon && (
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", accent ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-[11px] font-bold text-(--text-tertiary)">{label}</div>
        <div className={cn("truncate text-[22px] font-black tabular-nums", valueClassName)}>{value}</div>
      </div>
    </div>
  );
}
