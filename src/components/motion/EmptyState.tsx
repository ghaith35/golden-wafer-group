import { cn } from "@/lib/utils";

/// Friendly empty list: gently floating icon with a soft halo.
export function EmptyState({ icon, title, hint, action, className }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="gw-float relative mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-(--bg-sunken) text-(--brand-600)">
        <span aria-hidden className="absolute inset-0 rounded-3xl" style={{ boxShadow: "0 0 0 8px color-mix(in srgb, var(--brand-500) 10%, transparent), 0 0 40px color-mix(in srgb, var(--brand-500) 25%, transparent)" }} />
        <span className="relative">{icon}</span>
      </div>
      <p className="text-base font-black text-(--text-primary)">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-(--text-secondary)">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
