"use client";

import { useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { haptic } from "@/lib/motion";

/// Phone list row: swipe toward the end edge to reveal `actions` (Edit/Delete…).
/// Works in LTR and RTL. Taps on the row still pass through when closed.
export function SwipeRow({ children, actions, width = 132 }: { children: React.ReactNode; actions: React.ReactNode; width?: number }) {
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; lock: boolean | null } | null>(null);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const sign = rtl ? 1 : -1; // opening direction

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, base: x, lock: null };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.lock === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.lock = Math.abs(dx) > Math.abs(dy);
    if (!s.lock) return;
    setDrag(true);
    const v = (s.base + dx) * sign; // 0..width when opening
    setX(Math.max(0, Math.min(width + 24, v)) * sign);
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s?.lock) return;
    setDrag(false);
    const open = Math.abs(x) > width * 0.4;
    if (open !== (Math.abs(s.base) > 0)) haptic("tap");
    setX(open ? width * sign : 0);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 end-0 flex items-stretch" style={{ width }} aria-hidden={x === 0}>{actions}</div>
      <div
        className="relative touch-pan-y bg-(--bg-page)"
        style={{ transform: `translateX(${x}px)`, transition: drag ? "none" : "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {children}
      </div>
    </div>
  );
}

/// Standard Edit (amber) + Delete (red) pair for <SwipeRow actions>.
export function SwipeEditDelete({ onEdit, onDelete, editLabel, deleteLabel }: { onEdit: () => void; onDelete: () => void; editLabel: string; deleteLabel: string }) {
  return (
    <>
      <button type="button" aria-label={editLabel} onClick={onEdit} className="flex flex-1 items-center justify-center bg-amber-500 text-white active:brightness-90"><Pencil size={18} /></button>
      <button type="button" aria-label={deleteLabel} onClick={onDelete} className="flex flex-1 items-center justify-center bg-red-500 text-white active:brightness-90"><Trash2 size={18} /></button>
    </>
  );
}
