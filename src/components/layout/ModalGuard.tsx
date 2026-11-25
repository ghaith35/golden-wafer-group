"use client";

import { useEffect } from "react";

/// One rule for EVERY popup in the app (modals, bottom sheets, lightboxes,
/// ticket previews, drawers…): while the top-most popup is open, everything
/// outside it is `inert` (cannot be clicked, tapped, focused or read by
/// screen readers) and the page behind cannot scroll. Popups don't each need
/// to remember to do it — they are detected from the DOM.
const POPUP =
  '[role="dialog"], [aria-modal="true"], .ticket-print-scope, div.fixed.inset-0[class*="z-50"], div.fixed.inset-0[class*="z-["]';

export function ModalGuard() {
  useEffect(() => {
    const marked = new Set<Element>();
    let raf = 0;
    // Overlay of the top-most open popup (null = nothing open).
    let activeRoot: Element | null = null;
    let prevHtml = "";
    let prevBody = "";

    const release = () => {
      marked.forEach((el) => el.removeAttribute("inert"));
      marked.clear();
    };

    const sync = () => {
      raf = 0;
      release();
      const all = Array.from(document.querySelectorAll<HTMLElement>(POPUP)).filter((el) => {
        // Ignore popups hidden for print or not rendered.
        if (!el.isConnected || el.hasAttribute("data-no-modal-guard")) return false;
        // Tailwind classes are static across breakpoints: the sales detail
        // panel is "fixed inset-0 z-50" on phones but `lg:static` on desktop,
        // and the mobile drawer is `md:hidden`. Matching the class string
        // alone counted those as open popups, marking the whole app `inert`
        // and locking scroll — the sales page rendered but was frozen.
        // Trust the computed style: only an overlay that is actually visible
        // and out of flow may lock the page.
        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        return (cs.position === "fixed" || cs.position === "absolute") && el.getClientRects().length > 0;
      });
      const html = document.documentElement;
      if (all.length === 0) {
        if (activeRoot) {
          html.style.overflow = prevHtml;
          document.body.style.overflow = prevBody;
        }
        activeRoot = null;
        html.removeAttribute("data-modal-open");
        return;
      }
      if (!activeRoot) {
        prevHtml = html.style.overflow;
        prevBody = document.body.style.overflow;
      }
      html.setAttribute("data-modal-open", "");
      html.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      const top = all[all.length - 1];
      // Keep the popup's own backdrop alive: isolate its full-screen overlay.
      const root = top.closest(".fixed.inset-0") ?? top;
      activeRoot = root;
      for (let node: Element | null = root; node && node !== document.body; node = node.parentElement) {
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        for (const sib of Array.from(parent.children)) {
          if (sib === node) continue;
          const tag = sib.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || sib.hasAttribute("inert")) continue;
          sib.setAttribute("inert", "");
          marked.add(sib);
        }
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };

    // Hard lock, independent of CSS: wheel / touch-drag / scroll keys that
    // start outside the open popup never reach whatever scrolls behind it.
    const blockOutside = (e: Event) => {
      if (!activeRoot) return;
      if (e.target instanceof Node && activeRoot.contains(e.target)) return;
      if (e.cancelable) e.preventDefault();
    };
    const blockKeys = (e: KeyboardEvent) => {
      if (!activeRoot) return;
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t && activeRoot.contains(t)) return;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
    };
    document.addEventListener("wheel", blockOutside, { passive: false, capture: true });
    document.addEventListener("touchmove", blockOutside, { passive: false, capture: true });
    document.addEventListener("keydown", blockKeys, true);
    // A breakpoint change can turn a "popup" into a static panel (or hide it).
    window.addEventListener("resize", schedule);

    // childList only: our own `inert` attribute changes must not re-trigger us.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      mo.disconnect();
      document.removeEventListener("wheel", blockOutside, true);
      document.removeEventListener("touchmove", blockOutside, true);
      document.removeEventListener("keydown", blockKeys, true);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
      release();
      document.documentElement.removeAttribute("data-modal-open");
    };
  }, []);

  return null;
}
