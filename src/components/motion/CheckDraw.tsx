import { cn } from "@/lib/utils";

/// Self-drawing check (or cross) — circle strokes in, then the tick.
export function CheckDraw({ size = 22, kind = "success", className }: { size?: number; kind?: "success" | "error" | "info"; className?: string }) {
  const color = kind === "success" ? "#10b981" : kind === "error" ? "#ef4444" : "var(--brand-500)";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn("gw-check shrink-0", className)} aria-hidden>
      <circle cx="12" cy="12" r="10" pathLength={1} />
      {kind === "success" && <path d="M7.5 12.5l3 3 6-6.5" pathLength={1} />}
      {kind === "error" && <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" pathLength={1} />}
      {kind === "info" && <path d="M12 11v5M12 8h.01" pathLength={1} />}
    </svg>
  );
}
