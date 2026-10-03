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
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3", className)}>
      {icon && (
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", accent ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-[11px] font-bold uppercase tracking-wider opacity-60">{label}</div>
        <div className="truncate text-lg font-black tabular-nums">{value}</div>
      </div>
    </div>
  );
}
