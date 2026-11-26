"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { haptic, isLiteDevice, prefersReducedMotion } from "@/lib/motion";
import { finishMorph, startMorph } from "@/lib/morph";

const RIPPLE_SEL = 'button, [role="button"], a[class*="rounded"]';

/// Global motion plumbing, mounted once (locale layout):
///  · lite-device detection (adds html.gw-lite)
///  · route progress bar (starts on internal link click, finishes on route change)
///  · touch ripple (overlay on <body>, never mutates React-owned DOM)
///  · light haptic tap on primary / submit buttons (APK)
export function MotionBoot() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement | null>(null);
  const prog = useRef({ p: 0, timer: 0, safety: 0, active: false });

  const finish = () => {
    const s = prog.current, host = bar.current, i = fill.current;
    if (!s.active || !host || !i) return;
    s.active = false;
    window.clearInterval(s.timer);
    window.clearTimeout(s.safety);
    i.style.transform = "scaleX(1)";
    window.setTimeout(() => { host.style.opacity = "0"; }, 180);
    window.setTimeout(() => { if (!prog.current.active) { i.style.transition = "none"; i.style.transform = "scaleX(0)"; } }, 480);
  };

  // Route changed → complete the bar.
  useEffect(() => { finish(); finishMorph(); }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    if (isLiteDevice()) root.classList.add("gw-lite");
    const reduce = prefersReducedMotion();

    const start = () => {
      const s = prog.current, host = bar.current, i = fill.current;
      if (!host || !i || s.active || reduce) return;
      s.active = true;
      s.p = 0.08;
      i.style.transition = "none";
      i.style.transform = "scaleX(0.04)";
      host.style.opacity = "1";
      requestAnimationFrame(() => {
        i.style.transition = "transform 0.3s ease-out";
        i.style.transform = `scaleX(${s.p})`;
      });
      s.timer = window.setInterval(() => {
        s.p += (0.92 - s.p) * 0.1;
        i.style.transform = `scaleX(${s.p.toFixed(3)})`;
      }, 220);
      s.safety = window.setTimeout(finish, 9000);
    };

    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el) return;
      const a = el.closest("a[href]") as HTMLAnchorElement | null;
      if (a && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.target !== "_blank" && !a.hasAttribute("download")) {
        try {
          const u = new URL(a.href, location.href);
          if (u.origin === location.origin && u.pathname !== location.pathname) {
            start();
            // Card → page container transform. Next's <Link> prevents default
            // in the bubble phase, so check after dispatch.
            if (!reduce && !root.classList.contains("gw-lite")) {
              window.setTimeout(() => { if (e.defaultPrevented) startMorph(a); }, 0);
            }
          }
        } catch { /* bad href */ }
      }
      const b = el.closest('button.bg-gradient-brand, button[type="submit"]');
      if (b && !(b as HTMLButtonElement).disabled) haptic("tap");
    };

    const onDown = (e: PointerEvent) => {
      if (reduce || root.classList.contains("gw-lite") || e.button > 0) return;
      const t = e.target as Element | null;
      const el = t?.closest(RIPPLE_SEL) as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled || el.closest(".leaflet-container, [data-no-ripple]") || el.getAttribute("role") === "switch") return;
      const r = el.getBoundingClientRect();
      if (r.width < 28 || r.height < 28 || r.width > 520 || r.height > 150) return;
      const cs = getComputedStyle(el);
      const host = document.createElement("span");
      host.className = "gw-ripple-host";
      Object.assign(host.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: cs.borderRadius, color: cs.color });
      const size = Math.hypot(Math.max(e.clientX - r.left, r.right - e.clientX), Math.max(e.clientY - r.top, r.bottom - e.clientY)) * 2;
      const dot = document.createElement("span");
      dot.className = "gw-ripple";
      Object.assign(dot.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
      host.appendChild(dot);
      document.body.appendChild(host);
      window.setTimeout(() => host.remove(), 650);
    };

    // Validation / server errors (role="alert") shake once when they appear.
    const shake = (el: Element) => {
      if (reduce || el.classList.contains("gw-shake")) return;
      el.classList.add("gw-shake");
      haptic("error");
      window.setTimeout(() => el.classList.remove("gw-shake"), 600);
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as Element;
          if (el.matches('[role="alert"]')) shake(el);
          else el.querySelectorAll?.('[role="alert"]').forEach(shake);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      mo.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, []);

  return (
    <div ref={bar} className="gw-progress print:hidden" aria-hidden>
      <i ref={(n) => { fill.current = n; }} />
    </div>
  );
}
