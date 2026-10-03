"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/// Shared swipe gallery: touch-swipe + arrows + dots + counter.
/// Used everywhere a product is displayed (list thumb, form, sale lines…).
export function ProductGallery({
  images,
  alt,
  className,
}: {
  images: string[];
  alt: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  const swiped = useRef(false);

  if (images.length === 0) {
    return (
      <div className={cn("flex items-center justify-center rounded-xl bg-(--bg-sunken) text-2xl opacity-40", className)}>
        📦
      </div>
    );
  }

  const go = (dir: 1 | -1) => setIndex((i) => (i + dir + images.length) % images.length);
  /// Gallery owns its clicks: arrows/dots/image swipe in place and never
  /// bubble to the parent card (which would open the details popup).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={cn("relative overflow-hidden rounded-xl bg-(--bg-sunken)", images.length > 1 && "cursor-pointer", className)}
      onClick={(e) => {
        stop(e);
        if (swiped.current) {
          swiped.current = false;
          return;
        }
        if (images.length > 1) go(1);
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) {
          go(dx < 0 ? 1 : -1);
          swiped.current = true;
        }
        touchX.current = null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={images[index]} alt={alt} className="h-full w-full object-cover" draggable={false} />
      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="previous"
            onClick={(e) => { stop(e); go(-1); }}
            className="absolute start-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 px-2 py-1 text-white"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="next"
            onClick={(e) => { stop(e); go(1); }}
            className="absolute end-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 px-2 py-1 text-white"
          >
            ›
          </button>
          <div className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-1">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`image ${i + 1}`}
                onClick={(e) => { stop(e); setIndex(i); }}
                className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-white" : "w-1.5 bg-white/50")}
              />
            ))}
          </div>
          <span className="absolute end-1 top-1 rounded bg-black/40 px-1.5 text-[11px] text-white">
            {index + 1}/{images.length}
          </span>
        </>
      )}
    </div>
  );
}
