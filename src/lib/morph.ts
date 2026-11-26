import { EASE_OUT } from "@/lib/motion";

/// Container-transform page morph: the tapped card is cloned into a fixed
/// overlay on <body>, grows to fill the content area while its content fades,
/// then dissolves once the next page has mounted. The overlay lives outside
/// every page, so position:fixed bars inside pages are never re-anchored
/// (the problem with the View Transitions API).
let host: HTMLElement | null = null;
let safety = 0;
let startedAt = 0;
const GROW_MS = 440;

export function startMorph(a: HTMLElement): boolean {
  cancelMorph();
  const r = a.getBoundingClientRect();
  if (r.width < 120 || r.height < 52 || r.width > 780 || r.height > 480) return false;
  if (a.closest("nav, aside, header, [role=dialog], [aria-modal=true], .leaflet-container, [data-no-morph]")) return false;
  const cs = getComputedStyle(a);
  const radius = cs.borderTopLeftRadius;
  if (parseFloat(radius) < 10) return false;

  const mr = document.querySelector("main")?.getBoundingClientRect();
  const left = Math.max(0, mr?.left ?? 0);
  const top = Math.max(0, document.querySelector("header")?.getBoundingClientRect().bottom ?? 0);
  const target = { left, top, width: window.innerWidth - left, height: window.innerHeight - top };

  const h = document.createElement("div");
  h.className = "gw-morph print:hidden";
  Object.assign(h.style, {
    position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    borderRadius: radius, overflow: "hidden", pointerEvents: "none", zIndex: "2147481000",
    background: "var(--bg-overlay)", border: "1px solid var(--border-strong)", boxSizing: "border-box",
    boxShadow: "0 24px 60px -20px rgba(0,0,0,.45)", willChange: "left, top, width, height",
  } as Partial<CSSStyleDeclaration>);

  const clone = a.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  clone.setAttribute("inert", "");
  clone.setAttribute("aria-hidden", "true");
  clone.tabIndex = -1;
  Object.assign(clone.style, {
    position: "absolute", inset: "0", margin: "0", width: `${r.width}px`, height: `${r.height}px`,
    transform: "none", animation: "none", transition: "none", border: "0", boxShadow: "none",
  } as Partial<CSSStyleDeclaration>);
  h.appendChild(clone);
  document.body.appendChild(h);
  host = h;
  startedAt = performance.now();

  h.animate(
    [
      { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: radius, backgroundColor: "var(--bg-overlay)" },
      { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, borderRadius: "0px", backgroundColor: "var(--bg-page)" },
    ],
    { duration: GROW_MS, easing: EASE_OUT, fill: "forwards" }
  );
  clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 40, easing: "ease-in", fill: "forwards" });
  safety = window.setTimeout(finishMorph, 4500);
  return true;
}

function cancelMorph() {
  window.clearTimeout(safety);
  host?.remove();
  host = null;
}

/// Next page is in the DOM: let the expansion finish, then dissolve the overlay.
export function finishMorph() {
  if (!host) return;
  const h = host;
  host = null;
  window.clearTimeout(safety);
  const wait = Math.max(0, GROW_MS - 60 - (performance.now() - startedAt));
  const fade = h.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, delay: wait, easing: "ease-out", fill: "forwards" });
  fade.onfinish = () => h.remove();
  window.setTimeout(() => h.remove(), wait + 1200);
}
