"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Package, Plus, Search, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { dzMoney } from "@/lib/format";
import type { DocProduct } from "@/app/[locale]/(app)/sales/SaleDocForm";

export type PickerText = {
  title: string; search: string; all: string; selected: string; matches: string; selectAll: string; clear: string; add: string; noProducts: string; added: string; cancel: string;
};

/// Visual multi-product picker: image cards, search + category chips, tick many
/// (with quantity stepper) and insert them all at once.
export function SaleProductPicker({
  open, onClose, products, takenIds, priceOf, stockOf, subtitle, text, onAdd,
}: {
  open: boolean;
  onClose: () => void;
  products: DocProduct[];
  takenIds: string[];
  priceOf: (p: DocProduct) => number;
  stockOf?: (p: DocProduct) => string | null;
  subtitle?: string;
  text: PickerText;
  onAdd: (picked: Array<{ product: DocProduct; qty: number }>) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const taken = useMemo(() => new Set(takenIds), [takenIds]);

  useEffect(() => {
    if (open) { setQ(""); setCat(""); setPicked({}); }
  }, [open]);

  const cats = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.category) m.set(p.category.id, p.category.name);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter(
      (p) => (!cat || p.category?.id === cat) && (!needle || p.name.toLowerCase().includes(needle) || (p.barcode ?? "").toLowerCase().includes(needle))
    );
  }, [products, q, cat]);

  const available = filtered.filter((p) => !taken.has(p.id));
  const count = Object.keys(picked).length;
  const allOn = available.length > 0 && available.every((p) => picked[p.id] !== undefined);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = { ...s };
      if (n[id] !== undefined) delete n[id];
      else n[id] = 1;
      return n;
    });
  const step = (id: string, d: number) => setPicked((s) => (s[id] === undefined ? s : { ...s, [id]: Math.max(1, (s[id] ?? 1) + d) }));

  function submit() {
    const byId = new Map(products.map((p) => [p.id, p]));
    onAdd(Object.entries(picked).map(([id, qty]) => ({ product: byId.get(id)!, qty })).filter((x) => x.product));
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={text.title} subtitle={subtitle} icon="🛒" width="xl">
      <div className="space-y-3">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-(--text-tertiary)" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={text.search}
            className="h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) ps-10 pe-9 text-sm font-bold outline-none"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="clear" className="absolute end-2 top-1/2 flex h-7 min-h-0 w-7 min-w-0 -translate-y-1/2 items-center justify-center rounded-lg text-(--text-tertiary)">
              <X size={14} />
            </button>
          )}
        </label>

        {cats.length > 1 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {[{ id: "", name: text.all }, ...cats].map((c) => (
              <button
                key={c.id || "all"}
                type="button"
                onClick={() => setCat(c.id)}
                className={cn("min-h-0 shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-black transition-all", cat === c.id ? "border-transparent bg-gradient-brand text-(--brand-contrast)" : "border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) hover:border-(--brand-500)")}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-(--brand-500)/15 px-2.5 py-1 text-[11px] font-black text-(--gold-text)">{text.selected}: <b className="tabular-nums">{count}</b></span>
            <span className="rounded-full border border-(--border-default) px-2.5 py-1 text-[11px] font-bold text-(--text-secondary)">{text.matches}: <b className="tabular-nums">{filtered.length}</b></span>
          </div>
          <button
            type="button"
            disabled={available.length === 0}
            onClick={() => setPicked(allOn ? {} : Object.fromEntries(available.map((p) => [p.id, picked[p.id] ?? 1])))}
            className="min-h-0 rounded-lg border border-(--border-default) px-3 py-1.5 text-xs font-black text-(--text-secondary) hover:border-(--brand-500) disabled:opacity-40"
          >
            {allOn ? text.clear : text.selectAll}
          </button>
        </div>

        <div className="grid max-h-[min(52vh,520px)] grid-cols-2 gap-2.5 overflow-y-auto rounded-2xl border border-(--border-default) bg-(--bg-sunken) p-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => {
            const done = taken.has(p.id);
            const qty = picked[p.id];
            const on = qty !== undefined;
            const img = p.images?.[0]?.url;
            const stock = stockOf?.(p);
            return (
              <div
                key={p.id}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-xl border bg-(--bg-overlay) transition-all",
                  done ? "opacity-50" : on ? "border-(--brand-500) shadow-[0_10px_26px_-14px_var(--brand-500)]" : "border-(--border-default) hover:-translate-y-0.5 hover:border-(--border-strong)"
                )}
              >
                <button type="button" disabled={done} onClick={() => toggle(p.id)} className="relative block min-h-0 text-start">
                  <div className="relative aspect-[4/3] w-full bg-(--bg-surface)">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-(--text-tertiary)"><Package size={30} /></div>
                    )}
                    <span className={cn("absolute end-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all", on || done ? "border-transparent bg-gradient-brand text-(--brand-contrast)" : "border-white/80 bg-black/25 text-transparent")}>
                      <Check size={14} strokeWidth={3} />
                    </span>
                    {done && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-black text-white">{text.added}</span>}
                  </div>
                  <div className="space-y-0.5 p-2">
                    <div className="line-clamp-2 min-h-[2.2em] text-[12px] font-black leading-tight">{p.name}</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-black tabular-nums text-(--gold-text)" dir="ltr">{dzMoney(priceOf(p))}</span>
                      {stock && <span className="truncate text-[9.5px] font-bold text-(--text-tertiary)" dir="ltr">🏭 {stock}</span>}
                    </div>
                  </div>
                </button>
                {on && !done && (
                  <div className="flex items-center justify-between gap-1 border-t border-(--border-default) bg-(--gold-wash) px-1.5 py-1">
                    <button type="button" onClick={() => step(p.id, -1)} className="flex h-7 min-h-0 w-7 min-w-0 items-center justify-center rounded-lg bg-(--bg-overlay) text-(--text-primary)" aria-label="-"><Minus size={14} /></button>
                    <span className="text-sm font-black tabular-nums">{qty}</span>
                    <button type="button" onClick={() => step(p.id, 1)} className="flex h-7 min-h-0 w-7 min-w-0 items-center justify-center rounded-lg bg-(--bg-overlay) text-(--text-primary)" aria-label="+"><Plus size={14} /></button>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="col-span-full p-8 text-center text-sm font-bold text-(--text-tertiary)">{text.noProducts}</div>}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-(--border-default) text-sm font-black text-(--text-secondary) hover:border-(--brand-500)">{text.cancel}</button>
          <button type="button" onClick={submit} disabled={count === 0} className="bg-gradient-brand min-h-11 flex-[2] rounded-xl text-sm font-black text-(--brand-contrast) disabled:opacity-50">
            {text.add} · <span className="tabular-nums">{count}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
