import { haptic, isLiteDevice, prefersReducedMotion } from "@/lib/motion";

const COLORS = ["#e8ba4c", "#f3cf74", "#c9951a", "#10b981", "#ffffff", "#f06b63", "#60a5fa"];

/// Confetti burst (self-contained canvas, ~1.8s, auto-removed). Use for the big
/// moments: day closed, handover validated, big payment collected.
export function celebrate(opts: { x?: number; y?: number; count?: number } = {}) {
  if (typeof document === "undefined") return;
  haptic("success");
  if (prefersReducedMotion() || isLiteDevice()) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "2147483200" });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);
  const ox = opts.x ?? W / 2, oy = opts.y ?? H * 0.62;
  const n = opts.count ?? 90;
  const ps = Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
    const sp = 6 + Math.random() * 9;
    return { x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[(Math.random() * COLORS.length) | 0] };
  });
  const t0 = performance.now();
  const frame = (t: number) => {
    const el = t - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - el / 1800);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (el < 1800) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
