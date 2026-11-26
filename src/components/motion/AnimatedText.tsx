"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

// Integer groups ("1 250 000", "42"); decimals' fractional part is skipped.
const GROUP = /(?<![.,\d])\d{1,3}(?:[   ]\d{3})+(?![\d])|(?<![.,\d])\d+/g;

function groups(s: string) {
  return Array.from(s.matchAll(GROUP)).map((m) => {
    const raw = m[0];
    const sep = /[   ]/.exec(raw)?.[0] ?? "";
    return { start: m.index ?? 0, raw, sep, n: Number(raw.replace(/[   ]/g, "")) };
  });
}
function fmt(n: number, sep: string, width: number) {
  const d = String(Math.round(n));
  const padded = !sep && width > d.length ? d.padStart(width, "0") : d;
  return sep ? padded.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : padded;
}

/// Rolls every integer inside a pre-formatted string ("12 500 DA", "3 · 4 200 DA")
/// from its previous value to the new one. Anything unparseable shows as-is.
export function AnimatedText({ text, ms = 850, className }: { text: string; ms?: number; className?: string }) {
  const [shown, setShown] = useState(text);
  const prev = useRef<string | null>(null);
  const isoLike = /[:/]|\d-\d/.test(text);

  useLayoutEffect(() => {
    const from = prev.current === null ? text.replace(GROUP, "0") : prev.current;
    prev.current = text;
    const a = groups(from), b = groups(text);
    if (isoLike || prefersReducedMotion() || a.length !== b.length || b.length === 0 || from === text) {
      setShown(text);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 4);
      let out = "", at = 0;
      b.forEach((g, i) => {
        out += text.slice(at, g.start) + (p >= 1 ? g.raw : fmt(a[i].n + (g.n - a[i].n) * e, g.sep, g.raw.length));
        at = g.start + g.raw.length;
      });
      setShown(out + text.slice(at));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms, isoLike]);

  return <span className={className} aria-label={text}>{shown}</span>;
}
