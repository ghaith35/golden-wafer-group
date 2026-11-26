"use client";

import { useCountUp } from "@/components/dashboard/charts";

/// Number that rolls up to its value (and re-rolls when it changes).
export function CountUp({ value, format, ms = 800, className }: { value: number; format?: (n: number) => string; ms?: number; className?: string }) {
  const v = useCountUp(value, ms);
  const n = Math.round(v);
  return <span className={`gw-num ${className ?? ""}`}>{format ? format(n) : n.toLocaleString()}</span>;
}
