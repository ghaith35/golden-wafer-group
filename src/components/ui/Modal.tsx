"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/motion";

/// Bottom-sheet on mobile, centered dialog on desktop — Khiata-style popup.
/// Backdrop tap is ignored (✕ / Escape still close) so half-filled forms
/// aren't lost by a stray tap.
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  width = "md",
  wide,
  locked = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl" | "2xl";
  /** @deprecated use width="xl" instead */
  wide?: boolean;
  /// Locked: no ✕ button, Escape ignored — user must complete the action
  /// inside (e.g. livreur must scan the client QR before selling).
  locked?: boolean;
}) {
  const { mounted, state } = usePresence(open);
  // Mobile: drag the handle/header down to dismiss (sheet follows the finger).
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (locked) return;
    startY.current = e.touches[0].clientY;
    setDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    setDy(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (startY.current == null) return;
    startY.current = null;
    setDragging(false);
    if (dy > 110) onClose();
    setDy(0);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) {
        // A nested popup (product picker) closes itself first.
        if (document.querySelector("[data-nested-popup]")) return;
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
    };
  }, [open, onClose, locked]);

  if (!mounted) return null;

  const widthCls =
    wide || width === "xl"
      ? "max-w-[1120px]"
      : width === "2xl"
        ? "max-w-[1440px]"
        : width === "lg"
        ? "max-w-[760px]"
        : width === "sm"
          ? "max-w-[440px]"
          : "max-w-[640px]";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      data-state={state}
      className="gw-overlay fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:items-center md:p-5"
    >
      <div
        data-state={state}
        style={{
          transform: dy ? `translateY(${dy}px)` : undefined,
          transition: dragging ? "none" : "transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className={cn(
          "gw-panel flex max-h-[calc(var(--vh)*0.9)] w-full flex-col overflow-hidden rounded-t-2xl border border-(--border-default) bg-(--bg-overlay) shadow-2xl md:max-h-[calc(var(--vh)*0.92)] md:rounded-2xl",
          widthCls
        )}
      >
        <div
          className="flex shrink-0 touch-none justify-center pt-2 md:hidden"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <div className="mb-1 h-1 w-10 rounded-full bg-(--border-strong)" />
        </div>
        <div className="flex shrink-0 items-center gap-3 border-b border-(--border-default) px-5 pb-3 pt-1 md:pt-4">
          {icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-base font-black text-(--brand-contrast)">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-extrabold text-(--text-primary)">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-(--text-secondary)">{subtitle}</p>}
          </div>
          {!locked && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-(--border-default) text-(--text-secondary) transition-colors hover:bg-(--bg-sunken) hover:text-(--text-primary)"
          >
            <X size={17} />
          </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
