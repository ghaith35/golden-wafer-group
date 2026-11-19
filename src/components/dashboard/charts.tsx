"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/// Compact axis / badge number: 1 250 000 → 1.3M, 18 400 → 18K.
export function compactNum(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${s}${Math.round(a)}`;
}

/// Width of an element, kept fresh with ResizeObserver (charts draw in px so
/// text never stretches).
export function useSize<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h] as const;
}

/// Animated number: eases from the previous value to the new one.
export function useCountUp(target: number, ms = 750): number {
  const [v, setV] = React.useState(target);
  const from = React.useRef(target);
  React.useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from.current === target) {
      from.current = target;
      setV(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 4);
      setV(a + (target - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, ms]);
  return v;
}

export type TrendPoint = { label: string; revenue: number; profit: number };

/// 30-day combo chart: revenue bars (gold) + profit line (green) with hover tooltip.
export function TrendChart({
  data,
  minHeight = 260,
  revenueLabel,
  profitLabel,
  money,
}: {
  data: TrendPoint[];
  /// The chart fills its (flex) container; this is the floor.
  minHeight?: number;
  revenueLabel: string;
  profitLabel: string;
  money: (v: number) => string;
}) {
  const [ref, w, h] = useSize<HTMLDivElement>();
  const height = Math.max(minHeight, h);
  const [hover, setHover] = React.useState<number | null>(null);
  const padL = 46, padR = 10, padT = 14, padB = 26;
  const iw = Math.max(10, w - padL - padR);
  const ih = height - padT - padB;
  const max = Math.max(100, ...data.map((d) => Math.max(d.revenue, d.profit)));
  const niceMax = (() => {
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    const n = max / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  })();
  const n = data.length;
  const step = iw / Math.max(1, n);
  const bw = Math.max(3, Math.min(26, step * 0.62));
  const x = (i: number) => padL + step * i + step / 2;
  const y = (v: number) => padT + ih - (Math.max(0, v) / niceMax) * ih;
  const linePath = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.profit).toFixed(1)}`).join(" ");
  const areaPath = n ? `${linePath} L${x(n - 1).toFixed(1)},${padT + ih} L${x(0).toFixed(1)},${padT + ih} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = w < 520 ? 7 : w < 900 ? 4 : 3;
  const hv = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative min-h-0 w-full flex-1 select-none" style={{ minHeight }} dir="ltr">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${revenueLabel} / ${profitLabel}`} className="absolute inset-0 block overflow-visible">
          <defs>
            <linearGradient id="gw-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--brand-300)" }} />
              <stop offset="100%" style={{ stopColor: "var(--brand-600)" }} />
            </linearGradient>
            <linearGradient id="gw-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--semantic-success)", stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: "var(--semantic-success)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(niceMax * t)} y2={y(niceMax * t)} style={{ stroke: "var(--border-default)" }} strokeDasharray={t === 0 ? undefined : "3 5"} />
              <text x={padL - 8} y={y(niceMax * t) + 4} textAnchor="end" fontSize="10.5" fontWeight="700" style={{ fill: "var(--text-tertiary)" }}>
                {compactNum(niceMax * t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <g key={d.label + i}>
              {hover === i && <rect x={x(i) - step / 2} y={padT} width={step} height={ih} style={{ fill: "var(--brand-500)" }} opacity={0.08} />}
              <rect
                className="gw-bar-rise"
                x={x(i) - bw / 2}
                y={y(d.revenue)}
                width={bw}
                height={Math.max(0, padT + ih - y(d.revenue))}
                rx={Math.min(5, bw / 2)}
                fill="url(#gw-bar)"
                opacity={hover === null || hover === i ? 1 : 0.55}
                style={{ animationDelay: `${i * 18}ms`, transformOrigin: `${x(i)}px ${padT + ih}px` }}
              />
              {i % labelEvery === 0 || i === n - 1 ? (
                <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fontWeight="700" style={{ fill: "var(--text-tertiary)" }}>
                  {d.label}
                </text>
              ) : null}
            </g>
          ))}
          {n > 1 && <path d={areaPath} fill="url(#gw-area)" className="gw-fade-in" />}
          {n > 1 && <path d={linePath} fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--semantic-success)" }} className="gw-draw" pathLength={1} />}
          {data.map((d, i) => (
            <circle key={i} cx={x(i)} cy={y(d.profit)} r={hover === i ? 5 : 2.6} strokeWidth="2" style={{ fill: "var(--bg-overlay)", stroke: "var(--semantic-success)" }} />
          ))}
          {/* hit areas */}
          {data.map((_, i) => (
            <rect
              key={i}
              x={x(i) - step / 2}
              y={0}
              width={step}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </svg>
      )}
      {hv && hover !== null && w > 0 && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 rounded-xl border border-(--border-strong) bg-(--bg-overlay) px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(w - 90, Math.max(90, x(hover))), top: 0 }}
          dir="auto"
        >
          <div className="mb-1 font-black text-(--text-primary)">{hv.label}</div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-(--text-secondary)"><i className="h-2 w-2 rounded-full bg-(--brand-500)" />{revenueLabel}</span>
            <b className="tabular-nums">{money(hv.revenue)}</b>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-(--text-secondary)"><i className="h-2 w-2 rounded-full bg-(--semantic-success)" />{profitLabel}</span>
            <b className="tabular-nums text-(--semantic-success)">{money(hv.profit)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

export type DonutSeg = { label: string; value: number; color: string };

export function Donut({ segs, size = 150, thickness = 20, center }: { segs: DonutSeg[]; size?: number; thickness?: number; center?: React.ReactNode }) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} dir="ltr">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} style={{ stroke: "var(--bg-sunken)" }} />
        {total > 0 &&
          segs.map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={thickness}
                strokeLinecap="butt"
                stroke={s.color}
                strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`}
                strokeDashoffset={-acc}
                className="gw-donut"
              />
            );
            acc += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

/// Tiny bar sparkline (per-van 14-day trend).
export function MiniBars({ values, height = 56, className }: { values: number[]; height?: number; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={cn("flex items-end gap-[3px]", className)} style={{ height }} dir="ltr" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className="gw-bar-rise min-h-[3px] flex-1 rounded-t-[4px] bg-gradient-to-t from-(--brand-600) to-(--brand-300)"
          style={{ height: `${Math.max(4, (v / max) * 100)}%`, opacity: v === 0 ? 0.25 : 1, animationDelay: `${i * 25}ms`, transformOrigin: "bottom" }}
        />
      ))}
    </div>
  );
}
