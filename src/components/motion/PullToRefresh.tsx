"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Loader2 } from "lucide-react";
import { haptic } from "@/lib/motion";

const SKIP = ".leaflet-container, [role=dialog], [aria-modal=true], [data-no-ptr], input, textarea, select, canvas, [data-nested-popup]";
const THRESHOLD = 68;

function scrolledAncestor(el: Element | null): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && (n as HTMLElement).scrollTop > 0) return true;
  }
  return false;
}

/// Phone-only pull-down-to-refresh (re-runs the page's server data). Ignores
/// maps, popups, inputs and any inner scroller that isn't at its top.
export function PullToRefresh() {
  const router = useRouter();
  const [dist, setDist] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const st = useRef<{ y: number; on: boolean } | null>(null);
  const distRef = useRef(0);

  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    const set = (v: number) => { distRef.current = v; setDist(v); };
    const ts = (e: TouchEvent) => {
      const t = e.target as Element | null;
      st.current = window.scrollY <= 0 && t && !t.closest(SKIP) && !scrolledAncestor(t) ? { y: e.touches[0].clientY, on: false } : null;
    };
    const tm = (e: TouchEvent) => {
      const s = st.current;
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      if (dy <= 10 || window.scrollY > 0) { if (s.on) set(0); s.on = false; return; }
      if (!s.on) setPulling(true);
      s.on = true;
      if (e.cancelable) e.preventDefault();
      const d = Math.min(96, dy * 0.45);
      if (d >= THRESHOLD && distRef.current < THRESHOLD) haptic("tap");
      set(d);
    };
    const te = () => {
      const s = st.current;
      st.current = null;
      setPulling(false);
      if (!s?.on) return;
      if (distRef.current >= THRESHOLD) {
        setBusy(true);
        set(THRESHOLD);
        router.refresh();
        window.setTimeout(() => { setBusy(false); set(0); }, 900);
      } else set(0);
    };
    document.addEventListener("touchstart", ts, { passive: true });
    document.addEventListener("touchmove", tm, { passive: false });
    document.addEventListener("touchend", te, { passive: true });
    document.addEventListener("touchcancel", te, { passive: true });
    return () => {
      document.removeEventListener("touchstart", ts);
      document.removeEventListener("touchmove", tm);
      document.removeEventListener("touchend", te);
      document.removeEventListener("touchcancel", te);
    };
  }, [router]);

  if (dist === 0 && !busy) return null;
  const ready = dist >= THRESHOLD;
  return (
    <div className="gw-ptr print:hidden" style={{ transform: `translateY(${dist - 40}px)`, opacity: Math.min(1, dist / 40), transition: pulling ? "none" : "transform 0.25s var(--ease-out), opacity 0.2s" }} aria-hidden>
      <div>{busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowDown size={18} style={{ transform: `rotate(${ready ? 180 : 0}deg)`, transition: "transform 0.25s var(--ease-spring)" }} />}</div>
    </div>
  );
}
