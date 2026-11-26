"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/// Minimal product shape for the searchable picker.
export type PickerProduct = {
  id: string;
  name: string;
  barcode?: string | null;
  images: Array<{ url: string }>;
  conversions: Array<{ barcode?: string | null }>;
};

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

function matchBarcode<T extends PickerProduct>(products: T[], q: string): T | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  for (const p of products) {
    if ((p.barcode ?? "").toLowerCase() === needle) return p;
    if (p.conversions.some((c) => (c.barcode ?? "").toLowerCase() === needle)) return p;
  }
  return null;
}

/// Searchable product picker with images (type to filter, Enter picks first
/// match, barcode scan supported). Shared by purchases, sales and transfers.
/// `renderMeta` draws the second line + trailing element per row (stock,
/// availability, prices…).
export function ProductPicker<T extends PickerProduct>({
  products,
  value,
  onPick,
  placeholder,
  renderMeta,
  renderTrailing,
}: {
  products: T[];
  value: string;
  onPick: (p: T) => void;
  placeholder: string;
  renderMeta?: (p: T) => ReactNode;
  renderTrailing?: (p: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = products.find((x) => x.id === value);
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      products
        .filter(
          (x) =>
            !needle ||
            x.name.toLowerCase().includes(needle) ||
            (x.barcode ?? "").toLowerCase().includes(needle) ||
            x.conversions.some((c) => (c.barcode ?? "").toLowerCase() === needle)
        )
        .slice(0, 60),
    [products, needle]
  );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setQ(""); setOpen((o) => !o); }}
        className={cn(inputCls, "flex h-12 items-center gap-2 text-start")}
      >
        {selected?.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={selected.images[0].url} alt={selected.name} className="h-8 w-8 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-base">📦</span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {selected ? selected.name : <span className="font-normal opacity-50">{placeholder}</span>}
        </span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="close" onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
          {/* Inline panel (in-flow, not absolute) so it is never clipped by
              modal/dialog scroll containers — the form grows instead. */}
          <div className="relative z-20 mt-1 overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-overlay) shadow-xl">
            <div className="relative border-b border-(--border-subtle)">
              <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 opacity-50" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const hit = matchBarcode(products, q);
                    if (hit) {
                      onPick(hit);
                      setOpen(false);
                    } else if (filtered.length > 0) {
                      onPick(filtered[0]);
                      setOpen(false);
                    }
                  }
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder={placeholder}
                className="h-11 w-full bg-transparent py-2 pe-3 ps-9 text-sm outline-none"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-1.5">
              {filtered.length === 0 && <p className="p-2 text-xs opacity-60">—</p>}
              {filtered.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => { onPick(x); setOpen(false); }}
                  className="flex w-full items-start gap-2.5 rounded-lg p-2 text-start transition-colors hover:bg-(--bg-sunken)"
                >
                  {x.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={x.images[0].url} alt={x.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-lg">📦</span>
                  )}
                  <span className="min-w-0 flex-1" dir="auto">
                    <span className="block break-words text-[13px] font-bold">{x.name}</span>
                    {renderMeta && (
                      <span className="mt-0.5 block min-w-0 text-[11px] leading-5 break-words">
                        {renderMeta(x)}
                      </span>
                    )}
                  </span>
                  {renderTrailing?.(x)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
