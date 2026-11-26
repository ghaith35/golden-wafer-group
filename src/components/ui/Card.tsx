import * as React from "react";
import { cn } from "@/lib/utils";
import { AnimatedText } from "@/components/motion/AnimatedText";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 transition-[border-color,box-shadow] duration-200", className)} {...props} />;
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
          <div className="line-clamp-2 text-[11px] font-bold leading-tight text-(--text-tertiary)">{label}</div>
          <div className={cn("break-words text-base font-black leading-tight tabular-nums", valueClassName)}><AnimatedText text={value} /></div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("group relative flex flex-col items-start gap-2 overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-(--border-strong) hover:shadow-[var(--card-edge),var(--card-shadow-hover)] sm:flex-row sm:items-center sm:gap-3 sm:p-3.5", className)}>
      {icon && (
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl [&>svg]:transition-transform [&>svg]:duration-300 group-hover:[&>svg]:scale-125 group-hover:[&>svg]:-rotate-6 sm:h-12 sm:w-12", accent ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
          <span aria-hidden className="pointer-events-none absolute -end-5 -top-5 h-20 w-20 rounded-full bg-current opacity-[0.10] blur-2xl transition-opacity duration-300 group-hover:opacity-25" />
          {icon}
        </div>
      )}
      <div className="w-full min-w-0">
        <div className="line-clamp-2 text-[11px] font-bold leading-tight text-(--text-tertiary)">{label}</div>
        <div className={cn("break-words text-[clamp(16px,5vw,22px)] font-black leading-tight tabular-nums sm:whitespace-nowrap sm:text-[22px]", valueClassName)}><AnimatedText text={value} /></div>
      </div>
    </div>
  );
}
