"use client";

import { useLayoutEffect, useRef } from "react";
import { EASE_OUT, prefersReducedMotion } from "@/lib/motion";

/// FLIP reorder animation for a list container: give each direct child a stable
/// `data-flip="<key>"`; when items are added/removed/reordered, survivors glide
/// to their new spot. Container should be `position: relative`.
export function useFlip<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = new Map<string, { x: number; y: number }>();
    const reduce = prefersReducedMotion();
    for (const c of Array.from(el.children) as HTMLElement[]) {
      const key = c.dataset.flip;
      if (!key) continue;
      const pos = { x: c.offsetLeft, y: c.offsetTop };
      next.set(key, pos);
      const p = prev.current.get(key);
      if (p && !reduce && (p.x !== pos.x || p.y !== pos.y)) {
        c.animate([{ transform: `translate(${p.x - pos.x}px, ${p.y - pos.y}px)` }, { transform: "none" }], { duration: 340, easing: EASE_OUT });
      }
    }
    prev.current = next;
  });
  return ref;
}
