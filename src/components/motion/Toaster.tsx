"use client";

import { useEffect, useRef, useState } from "react";
import { CheckDraw } from "@/components/motion/CheckDraw";
import type { ToastDetail } from "@/lib/toast";

type Live = ToastDetail & { leaving?: boolean };

/// Global toast host: slide/spring in, progress bar, swipe sideways to dismiss,
/// stacks (max 4). Mounted once in the locale layout.
export function Toaster() {
  const [items, setItems] = useState<Live[]>([]);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = (id: number) => {
    setItems((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 240);
    const tm = timers.current.get(id);
    if (tm) window.clearTimeout(tm);
    timers.current.delete(id);
  };

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      setItems((l) => [...l.filter((t) => !t.leaving).slice(-3), d]);
      timers.current.set(d.id, window.setTimeout(() => dismiss(d.id), d.ms));
    };
    window.addEventListener("gw-toast", on);
    const map = timers.current;
    return () => {
      window.removeEventListener("gw-toast", on);
      map.forEach((t) => window.clearTimeout(t));
      map.clear();
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="gw-toaster print:hidden" role="status" aria-live="polite">
      {items.map((t) => (
        <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ t, onClose }: { t: Live; onClose: () => void }) {
  const startX = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const tone = t.kind === "success" ? "#10b981" : t.kind === "error" ? "#ef4444" : "var(--brand-500)";
  return (
    <div
      className="gw-toast"
      data-leaving={t.leaving ? "true" : undefined}
      dir="auto"
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, opacity: dx ? Math.max(0.2, 1 - Math.abs(dx) / 220) : undefined, borderInlineStartColor: tone, borderInlineStartWidth: 3 }}
      onPointerDown={(e) => { startX.current = e.clientX; }}
      onPointerMove={(e) => { if (startX.current != null) setDx(e.clientX - startX.current); }}
      onPointerUp={() => { const far = Math.abs(dx) > 70; startX.current = null; if (far) onClose(); else setDx(0); }}
      onPointerCancel={() => { startX.current = null; setDx(0); }}
    >
      <CheckDraw kind={t.kind} />
      <span className="min-w-0 flex-1 break-words">{t.msg}</span>
      <i className="gw-toast-bar" style={{ background: tone, animationDuration: `${t.ms}ms` }} />
    </div>
  );
}
