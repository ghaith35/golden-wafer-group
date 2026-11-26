"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { usePresence } from "@/lib/motion";

/// Thumb-friendly bottom sheet: slides up, drag the handle down (or tap the
/// backdrop / ✕ / Escape) to close. Works on every phone:
///  · the sheet's own footer pads with the safe-area inset (iPhone gesture
///    bar, Android edge-to-edge) and never less than 12px;
///  · when the on-screen keyboard opens (visual-viewport), the whole sheet
///    lifts above it so the focused field is never hidden;
///  · height is capped to the visible area (dynamic viewport, zoom-aware).
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
}) {
  const kb = useKeyboardInset();
  const { mounted, state } = usePresence(open);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector("[data-nested-popup]")) return;
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    setDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    setDy(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    setDragging(false);
    startY.current = null;
    if (dy > 90) onClose();
    setDy(0);
  };

  return (
    <div className="fixed inset-x-0 top-0 z-50 print:hidden" style={{ bottom: kb }} data-testid={testId} data-state={state}>
      <button
        type="button"
        aria-label="close"
        tabIndex={-1}
        onClick={onClose}
        className="gw-backdrop absolute inset-0 cursor-default bg-black/55 backdrop-blur-[2px]"
        style={{ opacity: dragging ? Math.max(0.3, 1 - dy / 400) : 1 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-state={state}
        className="gw-sheet absolute inset-x-0 bottom-0 mx-auto flex max-h-[92%] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-b-0 border-(--border-default) bg-(--bg-page) shadow-[0_-18px_48px_-12px_rgba(0,0,0,0.45)]"
        style={{
          transform: dy ? `translateY(${dy}px)` : undefined,
          transition: dragging ? "none" : "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Drag handle + title: the whole header is the drag target */}
        <div
          className="shrink-0 touch-none select-none border-b border-(--border-default) px-4 pb-2.5 pt-2"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="mx-auto mb-2 h-1.5 w-11 rounded-full bg-(--border-strong)" />
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-black">{title}</div>
              {subtitle && <div className="truncate text-xs font-bold opacity-60">{subtitle}</div>}
            </div>
            <button
              type="button"
              aria-label="close"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken)"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
        {footer && (
          <div className="shrink-0 space-y-2 border-t border-(--border-default) bg-(--bg-overlay) px-3 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
