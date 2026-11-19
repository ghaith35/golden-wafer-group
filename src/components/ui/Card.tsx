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
    <div className={cn("flex flex-col items-start gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-3.5", className)}>
      {icon && (
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl sm:h-12 sm:w-12", accent ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
          {icon}
        </div>
      )}
      <div className="w-full min-w-0">
        <div className="line-clamp-2 text-[11px] font-bold leading-tight text-(--text-tertiary)">{label}</div>
        <div className={cn("whitespace-nowrap text-[clamp(16px,5vw,22px)] font-black leading-tight tabular-nums sm:text-[22px]", valueClassName)}>{value}</div>
      </div>
    </div>
  );
}
