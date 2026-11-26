"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Gift, Plus } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Modal } from "@/components/ui/Modal";
import { ProductThumb, type PickerCategory, type PickerProduct } from "@/components/threepack/ProductPicker";
import { cn } from "@/lib/utils";
import { RuleBuilder } from "./RuleBuilder";
import { RuleCard } from "./RuleCard";
import { EqArrow, EqPlus, MiniTile } from "./EquationArt";
import type { GivenRow, Rule } from "./types";

type Builder = { rule: Rule | null; preset?: "SINGLE" | "PACK" | "PERCENT" | "PRICE" };

/// Gifted pack: free-colis rules. The list shows each rule as the equation it is
/// (photos bought → free photos); the builder is a 3-step flow with a live
/// receipt. Everything the admin changes here applies to the next sale.
export function ThreePackClient({
  locale,
  products,
  categories,
  initialRules,
}: {
  locale: string;
  products: PickerProduct[];
  categories: PickerCategory[];
  initialRules: Rule[];
}) {
  const t = useTranslations("threepack");
  const tc = useTranslations("common");
  const [tab, setTab] = useState<"rules" | "given">("rules");
  /// Filter the list by what a rule rewards (free goods · % off · new price).
  const [kind, setKind] = useState<"all" | "gift" | "percent" | "price">("all");
  const [rules, setRules] = useState<Rule[]>(initialRules);
  /// The whole create/edit wizard lives in a popup over the list (no page change).
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [given, setGiven] = useState<GivenRow[] | null>(null);
  /// The rule just saved glows once in the list (then settles).
  const [flashId, setFlashId] = useState<string | null>(null);
  async function reload() {
    const r = await fetch("/api/threepack/rules");
    if (r.ok) setRules(await r.json());
  }

  useEffect(() => {
    if (tab !== "given") return;
    fetch("/api/threepack/given")
      .then((r) => (r.ok ? r.json() : []))
      .then(setGiven)
      .catch(() => setGiven([]));
  }, [tab]);

  async function toggle(rule: Rule, isActive: boolean) {
    setRules((rs) => rs.map((x) => (x.id === rule.id ? { ...x, isActive } : x)));
    const r = await fetch(`/api/threepack/rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
    if (!r.ok) await reload();
  }

  const shown = useMemo(
    () => rules.filter((r) => kind === "all" || (kind === "gift" ? r.mode === "SINGLE" || r.mode === "PACK" : kind === "percent" ? r.mode === "PERCENT" : r.mode === "PRICE")),
    [rules, kind]
  );
  const kindCount = (k: "gift" | "percent" | "price") => rules.filter((r) => (k === "gift" ? r.mode === "SINGLE" || r.mode === "PACK" : k === "percent" ? r.mode === "PERCENT" : r.mode === "PRICE")).length;
  const activeCount = useMemo(() => rules.filter((r) => r.isActive).length, [rules]);
  const totalGiven = useMemo(() => rules.reduce((s, r) => s + r.givenColis, 0), [rules]);
  const fmtDate = (s: string) => new Date(s).toLocaleDateString(locale === "ar" ? "ar-DZ-u-nu-latn" : locale === "fr" ? "fr-DZ" : "en-GB");

  return (
    <div className="mx-auto w-full max-w-[120rem] space-y-6 p-5 md:p-8 xl:px-12 xl:py-10 2xl:px-16">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="bg-gradient-brand flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-(--brand-contrast)" aria-hidden>
            <Gift size={26} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-black leading-tight">{t("title")}</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-(--text-secondary)">{t("subtitle")}</p>
            {rules.length > 0 && (
              <p className="mt-2 text-xs font-bold text-(--text-secondary)">
                {t("summary", { active: String(activeCount), given: String(totalGiven) })}
              </p>
            )}
          </div>
        </div>
        {tab === "rules" && rules.length > 0 && (
          <button type="button" onClick={() => setBuilder({ rule: null })} className="bg-gradient-brand flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-black text-(--brand-contrast)">
            <Plus size={18} strokeWidth={3} />
            {t("newRule")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <SegmentedControl value={tab} onChange={setTab} options={[{ value: "rules", label: t("tabRules") }, { value: "given", label: t("tabGiven") }]} />
        </div>
        {tab === "rules" && rules.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterKind")}>
            {([
              ["all", t("kindAll"), rules.length],
              ["gift", t("kindGift"), kindCount("gift")],
              ["percent", t("kindPercent"), kindCount("percent")],
              ["price", t("kindPrice"), kindCount("price")],
            ] as const).map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn(
                  "h-10 rounded-full px-4 text-xs font-black transition-colors",
                  kind === k ? "bg-gradient-brand text-(--brand-contrast) shadow" : "border border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)"
                )}
              >
                {label} <span className="tabular-nums opacity-70">({n})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "rules" && (
        <>
          {rules.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-(--border-strong) bg-(--bg-overlay) px-5 py-10 text-center sm:px-10 sm:py-14">
              <div className="mb-8 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-5" aria-hidden>
                <MiniTile size="lg" qty="×10" />
                <EqPlus size={16} />
                <MiniTile size="lg" qty="×10" />
                <EqArrow size={20} />
                <MiniTile size="lg" gift qty="×1" />
              </div>
              <h2 className="text-2xl font-black">{t("emptyTitle")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-(--text-secondary)">{t("emptySub")}</p>
              <button type="button" onClick={() => setBuilder({ rule: null })} className="bg-gradient-brand mx-auto mt-8 flex min-h-12 items-center gap-2 rounded-xl px-6 text-sm font-black text-(--brand-contrast)">
                <Plus size={18} strokeWidth={3} />
                {t("newRule")}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 min-[1700px]:grid-cols-3 min-[2300px]:grid-cols-4">
              {shown.length === 0 && <p className="col-span-full rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{t("kindEmpty")}</p>}
              {shown.map((r) => (
                <RuleCard key={r.id} rule={r} flash={flashId === r.id} onToggle={(v) => void toggle(r, v)} onEdit={() => setBuilder({ rule: r })} />
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={!!builder} onClose={() => setBuilder(null)} title={builder?.rule ? t("editRule") : t("newRule")} icon={<Gift size={18} />} width="2xl">
        {builder && (
          <RuleBuilder
            // a fresh builder per rule so no state leaks between sessions
            key={builder.rule?.id ?? `new-${builder.preset ?? "any"}`}
            products={products}
            categories={categories}
            initial={builder.rule}
            presetMode={builder.preset}
            onCancel={() => setBuilder(null)}
            onSaved={async (id) => {
              await reload();
              setBuilder(null);
              setTab("rules");
              if (id) {
                setFlashId(id);
                window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 3800);
              }
            }}
          />
        )}
      </Modal>

      {tab === "given" && (
        <div className="overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) shadow-(--card-shadow)">
          {given === null ? (
            <p className="p-8 text-center text-sm text-(--text-secondary)">{tc("loading")}</p>
          ) : given.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-(--bg-sunken) text-(--text-tertiary)"><Gift size={22} /></span>
              <p className="text-sm font-bold text-(--text-secondary)">{t("emptyGiven")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-(--border-subtle) min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:divide-y-0">
              {given.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <ProductThumb src={g.imageUrl} name={g.product} size={48} className="rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black">{g.product}</p>
                    <p className="mt-0.5 truncate text-xs text-(--text-secondary)">
                      {g.client ?? "—"} · <span dir="ltr">{g.number}</span> · {fmtDate(g.date)}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded-full bg-(--semantic-success)/12 px-3 py-1 text-sm font-black tabular-nums text-(--semantic-success)")} dir="ltr">
                    {g.qty}{g.unit ? ` ${g.unit}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
