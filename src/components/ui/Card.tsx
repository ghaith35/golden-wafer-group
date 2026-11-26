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
  // Layout follows the CARD's own width (container query), not the screen's:
  // three cards in a row on a phone are ~110px wide — icon on top, text below,
  // full width for the value. Wide cards put the icon beside the text.
  if (compact) {
    return (
      <div title={title} className={cn("@container min-w-0 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5", className)}>
        <div className="flex flex-col items-start gap-1.5 @[9rem]:flex-row @[9rem]:items-center @[9rem]:gap-2.5">
          {icon && (
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", accent ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
              {icon}
            </div>
          )}
          <div className="w-full min-w-0">
            <div className="line-clamp-2 text-[11px] font-bold leading-tight text-(--text-tertiary)">{label}</div>
            <div className={cn("break-words text-[clamp(14px,4.4cqw,16px)] font-black leading-tight tabular-nums @[9rem]:text-base", valueClassName)}><AnimatedText text={value} /></div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("@container group relative min-w-0 overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-(--border-strong) hover:shadow-[var(--card-edge),var(--card-shadow-hover)] @[14rem]:p-3.5", className)}>
      <div className="flex flex-col items-start gap-2 @[14rem]:flex-row @[14rem]:items-center @[14rem]:gap-3">
        {icon && (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl [&>svg]:transition-transform [&>svg]:duration-300 group-hover:[&>svg]:scale-125 group-hover:[&>svg]:-rotate-6 @[14rem]:h-12 @[14rem]:w-12", accent ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
            <span aria-hidden className="pointer-events-none absolute -end-5 -top-5 h-20 w-20 rounded-full bg-current opacity-[0.10] blur-2xl transition-opacity duration-300 group-hover:opacity-25" />
            {icon}
          </div>
        )}
        <div className="w-full min-w-0">
          <div className="line-clamp-2 text-[11px] font-bold leading-tight text-(--text-tertiary)">{label}</div>
          <div className={cn("break-words text-[clamp(16px,6cqw,22px)] font-black leading-tight tabular-nums @[14rem]:whitespace-nowrap @[14rem]:text-[22px]", valueClassName)}><AnimatedText text={value} /></div>
        </div>
      </div>
    </div>
  );
}
