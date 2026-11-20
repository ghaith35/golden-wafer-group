"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, Gift, Package, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/Toggle";
import { ErrText } from "@/components/ui/ErrText";
import { ProductPicker, ProductSelect, ProductThumb, type PickerCategory, type PickerProduct } from "@/components/threepack/ProductPicker";
import { boughtForCombos, simulateGifts } from "@/lib/threepack/preview";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { QtyStepper } from "./QtyStepper";
import { EqArrow, EqPlus, MiniTile } from "./EquationArt";
import type { Rule } from "./types";

type Mode = "SINGLE" | "PACK";
type Slot = { productId: string; colis: string };
type Step = 0 | 1 | 2;

const EMPTY: Slot = { productId: "", colis: "" };
const num = (s: string) => Number(String(s).replace(",", "."));
const okQty = (s: string) => Number.isFinite(num(s)) && num(s) > 0;
const slotOk = (s: Slot) => !!s.productId && okQty(s.colis);
/// Rule names are capped at 80 characters; a long auto-name (big pack) is shortened, never rejected.
const fit = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);
const rise = { animation: "gw-rise 0.38s var(--ease-out) backwards" } as const;

function slotsOf(rule: Rule | null | undefined, role: "BUY" | "GIVE"): Slot[] {
  const s = rule?.items.filter((i) => i.role === role).map((i) => ({ productId: i.productId, colis: String(i.colis) })) ?? [];
  return s.length ? s : [{ ...EMPTY }];
}

/// Create / edit a rule in three guided steps (type → what the client buys →
/// what the client gets) with a live "receipt" that runs the real matching
/// logic, so what the admin sees is exactly what a sale will do.
export function RuleBuilder({
  products,
  categories,
  initial,
  presetMode,
  onCancel,
  onSaved,
}: {
  products: PickerProduct[];
  categories: PickerCategory[];
  initial?: Rule | null;
  presetMode?: Mode;
  onCancel: () => void;
  onSaved: (id?: string) => void | Promise<void>;
}) {
  const t = useTranslations("threepack");
  const [mode, setMode] = useState<Mode>(initial?.mode ?? presetMode ?? "SINGLE");
  const [buys, setBuys] = useState<Slot[]>(() => slotsOf(initial, "BUY"));
  const [gives, setGives] = useState<Slot[]>(() => slotsOf(initial, "GIVE"));
  const [name, setName] = useState(initial?.name ?? "");
  const [active, setActive] = useState(initial?.isActive ?? true);
  const [step, setStep] = useState<Step>(initial ? 2 : presetMode ? 1 : 0);
  const [reached, setReached] = useState<Step>(initial ? 2 : presetMode ? 1 : 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // live preview controls
  const [previewQty, setPreviewQty] = useState<string | null>(null);
  const [times, setTimes] = useState(1);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const nameOf = (id: string) => byId.get(id)?.name ?? "";

  // ── validation ──
  const buyIds = buys.map((b) => b.productId).filter(Boolean);
  const buyValid = buys.every(slotOk) && new Set(buyIds).size === buys.length && (mode === "SINGLE" ? buys.length === 1 : buys.length >= 2);
  const giveIds = gives.map((g) => g.productId).filter(Boolean);
  const giveValid = gives.every(slotOk) && new Set(giveIds).size === gives.length && (mode === "SINGLE" ? gives.length === 1 : gives.length >= 1);
  const stepValid = step === 0 ? true : step === 1 ? buyValid : giveValid;

  const autoName = buyValid && giveValid
    ? t("autoName", {
        buy: buys.map((b) => `${num(b.colis)} × ${nameOf(b.productId)}`).join(" + "),
        give: gives.map((g) => `${num(g.colis)} × ${nameOf(g.productId)}`).join(" + "),
      })
    : "";

  // ── actions ──
  function chooseMode(m: Mode) {
    setMode(m);
    if (m === "SINGLE") {
      setBuys((b) => [b[0] ?? { ...EMPTY }]);
      setGives((g) => [g[0] ?? { ...EMPTY }]);
    } else {
      setBuys((b) => (b.length >= 2 ? b : [...b, { ...EMPTY }]));
      setGives((g) => (g.length ? g : [{ ...EMPTY }]));
    }
    setPreviewQty(null);
  }

  function go(next: Step) {
    // Single: the free product is usually the bought one — prefill it (and 1 colis)
    // so the common case is zero clicks.
    if (next === 2 && mode === "SINGLE" && !gives[0]?.productId && buys[0]?.productId) {
      setGives([{ productId: buys[0].productId, colis: gives[0]?.colis || "1" }]);
    } else if (next === 2 && mode === "PACK" && gives.length === 1 && !gives[0].colis) {
      setGives([{ ...gives[0], colis: "1" }]);
    }
    setStep(next);
    setReached((r) => (next > r ? next : r) as Step);
    setError(null);
  }

  const patch = (side: "buy" | "give", i: number, p: Partial<Slot>) =>
    (side === "buy" ? setBuys : setGives)((list) => list.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const remove = (side: "buy" | "give", i: number) => (side === "buy" ? setBuys : setGives)((list) => list.filter((_, j) => j !== i));
  /// Pack: tick several products at once; ticking again removes them.
  function toggleMany(side: "buy" | "give", id: string) {
    (side === "buy" ? setBuys : setGives)((list) => {
      const has = list.some((s) => s.productId === id);
      if (has) return list.filter((s) => s.productId !== id).length ? list.filter((s) => s.productId !== id) : [{ ...EMPTY }];
      return [...list.filter((s) => s.productId), { productId: id, colis: "1" }];
    });
  }

  async function save() {
    setError(null);
    const items = [
      ...buys.map((b) => ({ role: "BUY" as const, productId: b.productId, colis: num(b.colis) })),
      ...gives.map((g) => ({ role: "GIVE" as const, productId: g.productId, colis: num(g.colis) })),
    ];
    setSaving(true);
    try {
      const r = await fetch(initial ? `/api/threepack/rules/${initial.id}` : "/api/threepack/rules", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fit(name.trim() || autoName), mode, isActive: active, items }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        // Zod failures: say WHICH field, never blame the quantities for a name problem.
        const field = Array.isArray(j.issues) ? j.issues[0]?.path?.[0] : undefined;
        setError(j.error === "validation_error" ? (field === "name" ? "name_too_long" : "rule_bad_qty") : (j.error ?? "save_failed"));
        return;
      }
      const saved = await r.json().catch(() => ({}));
      await onSaved(typeof saved.id === "string" ? saved.id : initial?.id);
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  }

  // ── live preview model (the real matcher, in plain colis) ──
  const buyItems = buys.filter(slotOk).map((b) => ({ productId: b.productId, colis: num(b.colis) }));
  const giveItems = gives.filter(slotOk).map((g) => ({ productId: g.productId, colis: num(g.colis) }));
  const complete = buyValid && giveValid;
  const singleBought = previewQty ?? (buys[0]?.colis ?? "");
  const bought = complete ? (mode === "SINGLE" ? { [buys[0].productId]: num(singleBought) || 0 } : boughtForCombos(buyItems, times)) : {};
  const gifts = complete ? simulateGifts(buyItems, giveItems, bought) : [];

  const stepLabels = [t("stepType"), t("stepBuy"), t("stepGift")];

  return (
    <div className="space-y-5">
      {/* progress (the popup supplies the title and the close button) */}
      <div>
        <ol className="flex items-center" aria-label={t("stepsAria")}>
          {stepLabels.map((label, i) => {
            const done = i < step || (i <= reached && i !== step && stepValidFor(i));
            const cur = i === step;
            const can = i <= reached;
            return (
              <li key={label} className={cn("flex items-center", i < 2 && "flex-1")}>
                <button
                  type="button"
                  disabled={!can}
                  onClick={() => can && go(i as Step)}
                  aria-current={cur ? "step" : undefined}
                  className="group flex items-center gap-2.5 rounded-xl py-1 pe-2 text-start disabled:cursor-default"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black transition-all duration-300",
                      cur ? "bg-gradient-brand text-(--brand-contrast) shadow-(--gold-glow)" : done ? "bg-(--gold-wash) text-(--gold-text)" : "border border-(--border-default) text-(--text-tertiary)",
                    )}
                  >
                    {done && !cur ? <Check size={16} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn("text-sm font-black transition-colors", cur ? "text-(--text-primary)" : "max-sm:hidden text-(--text-secondary)")}>{label}</span>
                </button>
                {i < 2 && <span className={cn("mx-2 h-0.5 flex-1 rounded-full transition-colors duration-300", i < step ? "bg-(--brand-500)" : "bg-(--border-default)")} aria-hidden />}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        {/* ── step card ── */}
        <div className="min-w-0 space-y-4">
          <section key={step} style={rise} className="py-1">
            {step === 0 && (
              <div className="space-y-5">
                <Head title={t("typeTitle")} sub={t("typeSub")} />
                <div role="radiogroup" aria-label={t("typeTitle")} className="grid gap-3 sm:grid-cols-2">
                  <TypeCard selected={mode === "SINGLE"} onSelect={() => chooseMode("SINGLE")} title={t("typeSingle")} desc={t("typeSingleDesc")}>
                    <MiniTile qty="×10" />
                    <EqArrow />
                    <MiniTile gift qty="×1" />
                  </TypeCard>
                  <TypeCard selected={mode === "PACK"} onSelect={() => chooseMode("PACK")} title={t("typePack")} desc={t("typePackDesc")}>
                    <MiniTile qty="×10" />
                    <EqPlus />
                    <MiniTile qty="×10" />
                    <EqArrow />
                    <MiniTile gift qty="×1" />
                  </TypeCard>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <Head title={t("buyTitle")} sub={mode === "SINGLE" ? t("buySingleSub") : t("buyPackSub")} />
                <Slots
                  side="buy"
                  mode={mode}
                  slots={buys}
                  products={products}
                  categories={categories}
                  patch={patch}
                  remove={remove}
                  toggleMany={toggleMany}
                  minRows={mode === "PACK" ? 2 : 1}
                />
                {mode === "PACK" && buys.filter((b) => b.productId).length < 2 && <Hint>{t("needTwo")}</Hint>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <Head title={t("giftTitle")} sub={t("giftSub")} />
                <Slots
                  side="give"
                  mode={mode}
                  slots={gives}
                  products={products}
                  categories={categories}
                  patch={patch}
                  remove={remove}
                  toggleMany={toggleMany}
                  minRows={1}
                  sameAs={mode === "SINGLE" && buys[0]?.productId && gives[0]?.productId !== buys[0].productId ? buys[0].productId : undefined}
                />

                <div className="space-y-4 border-t border-(--border-subtle) pt-5">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-black">{t("name")}</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={fit(autoName) || t("namePh")}
                      maxLength={80}
                      className="h-12 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) px-3.5 text-sm font-bold outline-none placeholder:font-medium placeholder:text-(--text-tertiary) focus:border-(--brand-500) focus:shadow-(--focus-ring)"
                    />
                    {!name && autoName && <span className="block text-xs text-(--text-tertiary)">{t("nameAuto")}</span>}
                  </label>
                  <div className="flex items-center justify-between gap-4 rounded-xl bg-(--bg-surface) px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black">{t("ruleActive")}</p>
                      <p className="text-xs text-(--text-secondary)">{t("ruleActiveHint")}</p>
                    </div>
                    <Switch checked={active} onChange={setActive} label={t("ruleActive")} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-5 rounded-xl bg-(--semantic-danger)/10 p-3 text-sm font-bold text-(--semantic-danger)">
                <ErrText code={error} />
              </p>
            )}
          </section>
        </div>

        {/* ── live receipt ── */}
        <aside className={cn("lg:sticky lg:top-4 max-lg:order-first", !complete && "max-lg:hidden")} aria-live="polite">
          <div className="overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) shadow-(--card-shadow)">
            <div className="flex items-center gap-2.5 border-b border-(--border-subtle) px-5 py-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--gold-wash) text-(--gold-text)"><Gift size={16} /></span>
              <h2 className="text-sm font-black">{t("previewTitle")}</h2>
            </div>

            {!complete ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-(--bg-sunken) text-(--text-tertiary)"><Package size={22} /></span>
                <p className="text-sm font-bold text-(--text-secondary)">{t("previewEmpty")}</p>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                {/* what the test client buys */}
                {mode === "SINGLE" ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold">{t("previewClientBuys")}</span>
                    <QtyStepper value={singleBought} onChange={setPreviewQty} label={t("previewClientBuys")} unit={t("colis")} className="h-14" />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold">{t("previewCombos")}</span>
                    <div role="radiogroup" aria-label={t("previewCombos")} className="flex gap-1">
                      {[1, 2, 3, 4].map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={times === n}
                          onClick={() => setTimes(n)}
                          className={cn("h-10 w-10 rounded-xl text-sm font-black tabular-nums transition-colors", times === n ? "bg-gradient-brand text-(--brand-contrast)" : "border border-(--border-default) text-(--text-secondary) hover:bg-(--bg-sunken)")}
                        >
                          ×{n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* the receipt */}
                <div className="rounded-xl bg-(--bg-surface) p-3">
                  <ul className="space-y-2.5">
                    {Object.entries(bought).map(([id, qty]) => (
                      <ReceiptRow key={`b-${id}`} product={byId.get(id)} right={`${qty} ${t("colis")}`} />
                    ))}
                  </ul>
                  <div className="my-3 border-t border-dashed border-(--border-strong)" />
                  {gifts.length === 0 ? (
                    <p className="px-1 py-2 text-xs font-bold text-(--text-secondary)">{t("previewNone")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {gifts.map((g) => (
                        <ReceiptRow
                          key={`g-${g.productId}`}
                          product={byId.get(g.productId)}
                          gift
                          freeLabel={t("free")}
                          right={`${g.colis} ${t("colis")}`}
                          sub={dzMoney(0)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-(--text-secondary)">{t("everyShort")}</p>
              </div>
            )}
          </div>
        </aside>
      </div>

        <div className="sticky bottom-0 z-20 -mx-5 -mb-4 flex items-center justify-between gap-3 border-t border-(--border-default) bg-(--bg-overlay) px-5 py-3">
          <button
            type="button"
            onClick={() => (step === 0 ? onCancel() : go((step - 1) as Step))}
            className="min-h-12 rounded-xl border border-(--border-default) px-5 text-sm font-black text-(--text-secondary) transition-colors hover:bg-(--bg-sunken)"
          >
            {step === 0 ? t("cancel") : t("back")}
          </button>
          {step < 2 ? (
            <button
              type="button"
              disabled={!stepValid}
              onClick={() => go((step + 1) as Step)}
              className="bg-gradient-brand flex min-h-12 items-center gap-2 rounded-xl px-7 text-sm font-black text-(--brand-contrast) transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              {t("next")}
              <ArrowRight size={16} className="rtl:rotate-180" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!complete || saving}
              onClick={() => void save()}
              className="bg-gradient-brand flex min-h-12 items-center gap-2 rounded-xl px-7 text-sm font-black text-(--brand-contrast) transition-opacity disabled:opacity-40 disabled:shadow-none"
            >
              <Check size={16} strokeWidth={3} />
              {saving ? t("saving") : t("saveRule")}
            </button>
          )}
        </div>
    </div>
  );

  function stepValidFor(i: number) {
    return i === 0 ? true : i === 1 ? buyValid : giveValid;
  }
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-black leading-tight">{title}</h2>
      <p className="max-w-prose text-sm text-(--text-secondary)">{sub}</p>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-(--semantic-warning)/12 px-3.5 py-2.5 text-xs font-bold text-(--semantic-warning)">{children}</p>;
}

function TypeCard({ selected, onSelect, title, desc, children }: { selected: boolean; onSelect: () => void; title: string; desc: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "relative flex flex-col gap-4 rounded-2xl border p-4 text-start transition-[border-color,background-color,box-shadow] duration-200",
        selected ? "border-(--brand-500) bg-(--gold-wash) shadow-(--gold-glow)" : "border-(--border-default) hover:border-(--border-strong) hover:bg-(--bg-surface)",
      )}
    >
      <span
        className={cn("absolute end-3.5 top-3.5 flex h-6 w-6 items-center justify-center rounded-full border transition-colors", selected ? "border-transparent bg-gradient-brand text-(--brand-contrast)" : "border-(--border-default) text-transparent")}
        aria-hidden
      >
        <Check size={14} strokeWidth={3} />
      </span>
      <span className="flex min-h-14 items-center gap-2.5 pt-1">{children}</span>
      <span className="space-y-1">
        <span className="block text-base font-black">{title}</span>
        <span className="block text-sm leading-snug text-(--text-secondary)">{desc}</span>
      </span>
    </button>
  );
}

/// The product rows of one side (buy / give): a product field + colis stepper
/// per row, and for packs a multi-select "add products" picker.
function Slots({
  side,
  mode,
  slots,
  products,
  categories,
  patch,
  remove,
  toggleMany,
  minRows,
  sameAs,
}: {
  side: "buy" | "give";
  mode: Mode;
  slots: Slot[];
  products: PickerProduct[];
  categories: PickerCategory[];
  patch: (side: "buy" | "give", i: number, p: Partial<Slot>) => void;
  remove: (side: "buy" | "give", i: number) => void;
  toggleMany: (side: "buy" | "give", id: string) => void;
  minRows: number;
  /// Single gift: one tap to reuse the bought product.
  sameAs?: string;
}) {
  const t = useTranslations("threepack");
  const pack = mode === "PACK";
  const taken = slots.map((s) => s.productId).filter(Boolean);
  const title = t("pickProduct");
  return (
    <div className="space-y-3">
      {slots.map((s, i) => {
        const dup = !!s.productId && taken.indexOf(s.productId) !== i;
        return (
          <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-stretch" style={rise}>
            <div className="min-w-0 flex-1">
              <ProductSelect
                products={products}
                categories={categories}
                value={s.productId}
                onChange={(id) => patch(side, i, { productId: id, colis: s.colis || (side === "give" ? "1" : "") })}
                placeholder={t("pickProduct")}
                title={title}
                invalid={dup}
              />
            </div>
            <div className="flex items-stretch gap-2 max-sm:w-full">
              <QtyStepper value={s.colis} onChange={(v) => patch(side, i, { colis: v })} label={t("qty")} unit={t("colis")} className="max-sm:flex-1" />
              {pack && slots.length > minRows && (
                <button type="button" onClick={() => remove(side, i)} aria-label={t("remove")} className="flex h-16 w-11 shrink-0 items-center justify-center rounded-2xl text-(--text-tertiary) transition-colors hover:bg-(--semantic-danger)/10 hover:text-(--semantic-danger)">
                  <Trash2 size={17} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {sameAs && (
        <button
          type="button"
          onClick={() => patch(side, 0, { productId: sameAs })}
          className="flex min-h-10 items-center gap-2 rounded-full border border-(--border-default) px-4 text-xs font-black text-(--gold-text) transition-colors hover:bg-(--gold-wash)"
        >
          <ProductThumb src={products.find((p) => p.id === sameAs)?.imageUrl} name="" size={22} className="rounded-md" />
          {t("sameProduct")}
        </button>
      )}

      {pack && (
        <ProductPicker products={products} categories={categories} selectedIds={taken} multi title={t("addProducts")} onPick={(id) => toggleMany(side, id)}>
          {({ open, toggle, triggerRef, panelId }) => (
            <button
              ref={triggerRef}
              type="button"
              onClick={toggle}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-(--border-strong) text-sm font-black text-(--gold-text) transition-colors hover:bg-(--gold-wash)"
            >
              <Plus size={18} />
              {t("addProducts")}
            </button>
          )}
        </ProductPicker>
      )}
    </div>
  );
}

function ReceiptRow({ product, right, sub, gift, freeLabel }: { product: PickerProduct | undefined; right: string; sub?: string; gift?: boolean; freeLabel?: string }) {
  return (
    <li className={cn("flex items-center gap-2.5", gift && "rounded-lg bg-(--semantic-success)/10 p-1.5")}>
      <ProductThumb src={product?.imageUrl} name={product?.name ?? ""} size={36} className="rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-black leading-tight">{product?.name ?? "—"}</span>
        {gift && freeLabel && (
          <span className="mt-0.5 inline-block rounded-full bg-(--semantic-success) px-1.5 text-[10px] font-black uppercase leading-4 text-white">{freeLabel}</span>
        )}
      </span>
      <span className="shrink-0 text-end">
        <span dir="ltr" className={cn("block text-[13px] font-black tabular-nums leading-tight", gift && "text-(--semantic-success)")}>{right}</span>
        {sub && <span dir="ltr" className="block text-[11px] font-bold tabular-nums text-(--text-secondary)">{sub}</span>}
      </span>
    </li>
  );
}
