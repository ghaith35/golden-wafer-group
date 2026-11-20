"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Package, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/// Product shape the picker needs (built server-side from the catalog).
export type PickerProduct = {
  id: string;
  name: string;
  reference: string | null;
  imageUrl: string | null;
  category: { id: string; name: string } | null;
  /// What "1 colis" is for this product, e.g. "Carton × 12".
  colisLabel: string | null;
};
export type PickerCategory = { id: string; name: string };

const RESULT_CAP = 150;
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ًͯ-ٟ]/g, "").toLowerCase();

/// Product photo tile; falls back to a tinted package glyph when there is no photo.
export function ProductThumb({ src, name, size = 44, className }: { src: string | null | undefined; name: string; size?: number; className?: string }) {
  const box = { width: size, height: size };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} loading="lazy" style={box} className={cn("shrink-0 rounded-xl border border-(--border-subtle) object-cover", className)} />
  ) : (
    <span style={box} className={cn("flex shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-tertiary)", className)} aria-hidden>
      <Package size={Math.round(size * 0.45)} />
    </span>
  );
}

type Api = { open: boolean; toggle: () => void; triggerRef: RefObject<HTMLButtonElement | null>; panelId: string };

/// Anchored product picker. The panel opens directly UNDER its trigger (or above
/// when there is no room) with photos, a search field and category chips. On a
/// phone it becomes a bottom sheet. Keyboard: type to search, ↑/↓ to move,
/// Enter to choose, Esc to close.
export function ProductPicker({
  products,
  categories,
  selectedIds,
  multi = false,
  title,
  onPick,
  children,
}: {
  products: PickerProduct[];
  categories: PickerCategory[];
  selectedIds: string[];
  /// Multi: the panel stays open and clicking toggles (for adding several at once).
  multi?: boolean;
  title: string;
  onPick: (id: string) => void;
  children: (api: Api) => ReactNode;
}) {
  const t = useTranslations("threepack");
  const uid = useId();
  const panelId = `${uid}-panel`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // Desktop placement: open under the field, or above when there is more room there;
  // the panel's max height always fits the free space (it can grow as rows are added).
  const [place, setPlace] = useState({ up: false, max: 448, top: 0, bottom: 0, left: 16, width: 512 });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [active, setActive] = useState(0);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const toggle = () => {
    if (open) return close(false);
    setQ("");
    setCat("");
    setActive(0);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 20;
      const above = r.top - 20;
      const up = below < 380 && above > below;
      const vw = window.innerWidth;
      const width = Math.min(512, vw - 32);
      const rtl = getComputedStyle(triggerRef.current).direction === "rtl";
      const left = Math.max(16, Math.min(rtl ? r.right - width : r.left, vw - width - 16));
      setPlace({ up, max: Math.max(240, Math.min(448, up ? above : below)), top: r.bottom + 8, bottom: window.innerHeight - r.top + 8, left, width });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true); // a scrolling modal body moves the field
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // selectedIds.length: a multi-pick can move the trigger while the panel is open
  }, [open, selectedIds.length]);

  // Outside click closes (the phone sheet has its own backdrop).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Fine pointers: jump straight into search. Touch: don't pop the keyboard over the sheet.
  useEffect(() => {
    if (open && window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
  }, [open]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) if (p.category) m.set(p.category.id, (m.get(p.category.id) ?? 0) + 1);
    return m;
  }, [products]);
  const chips = useMemo(() => categories.filter((c) => (counts.get(c.id) ?? 0) > 0), [categories, counts]);

  const { shown, total } = useMemo(() => {
    const needle = norm(q.trim());
    const all = products.filter(
      (p) => (!cat || p.category?.id === cat) && (!needle || norm(p.name).includes(needle) || (p.reference ? norm(p.reference).includes(needle) : false)),
    );
    return { shown: all.slice(0, RESULT_CAP), total: all.length };
  }, [products, q, cat]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${uid}-o-${shown[active]?.id}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, shown, uid]);

  const pick = (id: string) => {
    onPick(id);
    if (!multi) close();
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, shown.length - 1));
    } else if (e.key === "Enter") {
      const el = e.target as HTMLElement;
      // Only the search field drives the highlighted row; chips, Done and close keep their own Enter.
      if (el !== searchRef.current) return;
      e.preventDefault();
      const p = shown[active];
      if (p) pick(p.id);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      {children({ open, toggle, triggerRef, panelId })}
      {open && (
        <>
          <div className="fixed inset-0 z-[55] bg-black/50 sm:hidden" onClick={() => close(false)} aria-hidden />
          <div
            id={panelId}
            role="dialog"
            aria-label={title}
            onKeyDown={onKeyDown}
            data-nested-popup=""
            style={{ "--gp-max": `${place.max}px`, "--gp-top": `${place.top}px`, "--gp-bottom": `${place.bottom}px`, "--gp-left": `${place.left}px`, "--gp-w": `${place.width}px` } as React.CSSProperties}
            className={cn(
              "z-[60] flex flex-col overflow-hidden border border-(--border-strong) bg-(--bg-overlay) shadow-(--card-shadow-hover)",
              "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[84dvh] max-sm:rounded-t-3xl",
              "sm:fixed sm:left-(--gp-left) sm:max-h-(--gp-max) sm:w-(--gp-w) sm:rounded-2xl",
              place.up ? "sm:bottom-(--gp-bottom)" : "sm:top-(--gp-top)",
            )}
          >
            {/* phone sheet header */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 sm:hidden">
              <p className="text-base font-black">{title}</p>
              <button type="button" onClick={() => close()} aria-label={t("close")} className="flex h-9 w-9 items-center justify-center rounded-xl text-(--text-secondary) hover:bg-(--bg-sunken)">
                <X size={18} />
              </button>
            </div>

            {/* search */}
            <div className="shrink-0 p-3 pb-2">
              <label className="relative block">
                <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-(--text-tertiary)" aria-hidden />
                <input
                  ref={searchRef}
                  type="search"
                  role="combobox"
                  aria-expanded
                  aria-autocomplete="list"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setActive(0); }}
                  placeholder={t("searchProducts")}
                  aria-label={t("searchProducts")}
                  aria-controls={`${uid}-list`}
                  aria-activedescendant={shown[active] ? `${uid}-o-${shown[active].id}` : undefined}
                  autoComplete="off"
                  className="h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) ps-10 pe-10 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-(--text-tertiary) focus:border-(--brand-500) focus:shadow-(--focus-ring) [&::-webkit-search-cancel-button]:hidden"
                />
                {q && (
                  <button type="button" onClick={() => { setQ(""); setActive(0); searchRef.current?.focus(); }} aria-label={t("close")} className="absolute end-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-(--text-tertiary) hover:bg-(--bg-sunken)">
                    <X size={14} />
                  </button>
                )}
              </label>
            </div>

            {/* categories */}
            {chips.length > 0 && (
              <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t("allCategories")}>
                <Chip active={cat === ""} onClick={() => { setCat(""); setActive(0); }}>
                  {t("allCategories")} <span className="opacity-60">{products.length}</span>
                </Chip>
                {chips.map((c) => (
                  <Chip key={c.id} active={cat === c.id} onClick={() => { setCat(cat === c.id ? "" : c.id); setActive(0); }}>
                    {c.name} <span className="opacity-60">{counts.get(c.id)}</span>
                  </Chip>
                ))}
              </div>
            )}

            {/* results */}
            <div id={`${uid}-list`} role="listbox" aria-multiselectable={multi} aria-label={title} className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-(--border-subtle) p-1.5 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]">
              {shown.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                  <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-(--bg-sunken) text-(--text-tertiary)"><Search size={20} /></span>
                  <p className="text-sm font-black">{t("noResults")}</p>
                  <p className="text-xs text-(--text-secondary)">{t("noResultsHint")}</p>
                </div>
              ) : (
                shown.map((p, i) => {
                  const sel = selectedIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      id={`${uid}-o-${p.id}`}
                      aria-selected={sel}
                      onMouseMove={() => active !== i && setActive(i)}
                      onClick={() => pick(p.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl p-2 text-start transition-colors duration-150",
                        i === active && "bg-(--bg-sunken)",
                        sel && "bg-(--gold-wash)",
                      )}
                    >
                      <ProductThumb src={p.imageUrl} name={p.name} size={52} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black">{p.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-(--text-secondary)">
                          {[p.category?.name, p.colisLabel].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                          sel ? "border-transparent bg-gradient-brand text-(--brand-contrast)" : "border-(--border-default) text-transparent",
                        )}
                        aria-hidden
                      >
                        <Check size={14} strokeWidth={3} />
                      </span>
                    </button>
                  );
                })
              )}
              {total > shown.length && (
                <p className="px-3 py-3 text-center text-xs text-(--text-tertiary)">{t("showing", { shown: String(shown.length), total: String(total) })}</p>
              )}
            </div>

            {multi && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-(--border-default) bg-(--bg-surface) p-3">
                <p className="text-sm font-bold text-(--text-secondary)">{t("selectedCount", { n: String(selectedIds.length) })}</p>
                <button type="button" onClick={() => close()} className="bg-gradient-brand min-h-11 rounded-xl px-5 text-sm font-black text-(--brand-contrast)">
                  {t("done")}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-bold transition-colors duration-150",
        active
          ? "border-(--brand-500) bg-(--gold-wash) text-(--gold-text)"
          : "border-(--border-default) text-(--text-secondary) hover:border-(--border-strong) hover:bg-(--bg-sunken)",
      )}
    >
      {children}
    </button>
  );
}

/// The field a rule slot uses: shows the chosen product (photo + name + colis
/// unit) or an inviting empty state; opens the picker right under itself.
export function ProductSelect({
  products,
  categories,
  value,
  onChange,
  placeholder,
  title,
  invalid,
}: {
  products: PickerProduct[];
  categories: PickerCategory[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  title: string;
  invalid?: boolean;
}) {
  const sel = products.find((p) => p.id === value);
  return (
    <ProductPicker products={products} categories={categories} selectedIds={value ? [value] : []} title={title} onPick={onChange}>
      {({ open, toggle, triggerRef, panelId }) => (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className={cn(
            "flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border bg-(--bg-surface) p-2 pe-3.5 text-start transition-[border-color,box-shadow] duration-150",
            open ? "border-(--brand-500) shadow-(--focus-ring)" : invalid ? "border-(--semantic-danger)" : "border-(--border-default) hover:border-(--border-strong)",
          )}
        >
          {sel ? (
            <>
              <ProductThumb src={sel.imageUrl} name={sel.name} size={48} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black">{sel.name}</span>
                <span className="mt-0.5 block truncate text-xs text-(--text-secondary)">{[sel.category?.name, sel.colisLabel].filter(Boolean).join(" · ")}</span>
              </span>
            </>
          ) : (
            <>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-(--border-strong) text-(--gold-text)" aria-hidden>
                <Plus size={20} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-(--gold-text)">{placeholder}</span>
            </>
          )}
          <ChevronDown size={18} className={cn("shrink-0 text-(--text-tertiary) transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </button>
      )}
    </ProductPicker>
  );
}
