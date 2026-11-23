"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Package, X } from "lucide-react";
import { getVanSnapshot } from "@/lib/sync/client";
import { cn } from "@/lib/utils";

/// productId → image URLs, read from the phone's own sync snapshot (so it
/// works offline too; images already viewed are served by the service worker
/// cache). Empty map until the snapshot is read / when there is none.
export function useProductImages(): Map<string, string[]> {
  const [map, setMap] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    let dead = false;
    getVanSnapshot()
      .then((s) => {
        if (dead || !s) return;
        setMap(new Map((s.products ?? []).filter((p) => p.images?.length).map((p) => [p.id, p.images] as [string, string[]])));
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);
  return map;
}

/// Small product photo; tap = full-size popup (swipe/arrows through the
/// gallery). No photo / broken photo = the package icon. The tap never
/// reaches a parent row's own click action.
export function ProductThumb({
  name,
  images,
  className,
}: {
  name: string;
  images?: string[] | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState(false);
  const list = images ?? [];
  const url = list[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setI((x) => (x + 1) % list.length);
      if (e.key === "ArrowLeft") setI((x) => (x - 1 + list.length) % list.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, list.length]);

  if (!url || broken) {
    return (
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken)", className)}>
        <Package size={17} className="opacity-60" />
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-label={name}
        onClick={(e) => {
          e.stopPropagation();
          setI(0);
          setOpen(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn("h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-sunken) active:scale-95", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/85 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          role="dialog"
          aria-label={name}
        >
          <button
            type="button"
            aria-label="close"
            onClick={() => setOpen(false)}
            className="absolute end-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={list[i] ?? url}
            alt={name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[78vh] max-w-full rounded-2xl object-contain"
          />
          <p className="mt-3 max-w-full truncate text-center text-sm font-black text-white">{name}</p>
          {list.length > 1 && (
            <div className="mt-2 flex items-center gap-4 text-white" onClick={(e) => e.stopPropagation()}>
              <button type="button" aria-label="prev" onClick={() => setI((x) => (x - 1 + list.length) % list.length)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 rtl:rotate-180">
                <ChevronLeft size={20} />
              </button>
              <span className="text-xs font-black tabular-nums" dir="ltr">{i + 1} / {list.length}</span>
              <button type="button" aria-label="next" onClick={() => setI((x) => (x + 1) % list.length)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 rtl:rotate-180">
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
