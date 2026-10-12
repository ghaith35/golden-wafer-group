"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/// Tap-to-zoom product image: fullscreen overlay, instant open/close
/// (no motion effects). Tap-outside / ✕ / Escape closes.
export function ImageLightbox({
  src,
  alt,
  caption,
  onClose,
}: {
  src: string;
  alt: string;
  caption?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={alt}
      className="fixed inset-0 z-[80] flex flex-col bg-black/85 p-4 backdrop-blur-sm print:hidden"
      onClick={onClose}
    >
      <div className="flex shrink-0 justify-end">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-full max-w-full rounded-xl object-contain" />
      </div>
      {caption && (
        <p className="shrink-0 truncate pt-3 text-center text-sm font-bold text-white/90" dir="auto">
          {caption}
        </p>
      )}
    </div>
  );
}
