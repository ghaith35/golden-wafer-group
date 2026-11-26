"use client";

import { dz } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { ImageUploader } from "@/components/products/ImageUploader";
import {
  buildColisageText,
  draftFromConversions,
  previewFactors,
  type ColisDraft,
  type ColisMode,
} from "@/lib/products/colisage";
import { compareNatural } from "@/lib/sort";
import { priceForUnit } from "@/components/products/UnitQty";
import { QtyLadder, type LadderUnit, type LadderValue } from "@/components/products/QtyLadder";
import { resolveTierPrice } from "@/lib/pricing";
import { useSyncedState } from "@/lib/data-sync";


import { ErrText } from "@/components/ui/ErrText";
export type Ref = { id: string; name: string; symbol?: string | null };
export type ProductData = {
  id?: string;
  name: string;
  reference?: string | null;
  barcode?: string | null;
  colisage?: string | null;
  categoryId?: string | null;
  supplierId?: string | null;
  baseUnitId?: string | null;
  saleUnitId?: string | null;
  purchaseUnitId?: string | null;
  minStock: number;
  salePrice: number;
  costPrice: number;
  images: string[];
  conversions: Array<{ unitId: string; factor: number; barcode?: string | null }>;
  tierPrices: Array<{ tierId: string; price: number }>;
  /// Quantity ladder per colisage (unitKey "" = base unit, else Unit.id; tierId null = base sale price).
  qtyTiers?: Array<{ unitKey: string; minQty: number; tierId: string | null }>;
};

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

export function ProductForm({
  initial,
  categories,
  suppliers,
  units,
  tiers,
  labels,
  locale,
  onSuccess,
  onClose,
}: {
  initial: ProductData;
  categories: Ref[];
  suppliers: Ref[];
  units: Ref[];
  tiers: Ref[];
  labels: Record<string, string>;
  locale: string;
  onSuccess?: (id?: string) => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const goList = () => {
    router.push(`/${locale}/products`);
    router.refresh();
  };
  const handleSuccess = onSuccess ?? goList;
  const handleClose = onClose ?? goList;
  const [form, setForm] = useState<ProductData>(initial);
  const tp = useTranslations("products");
  const [genBusy, setGenBusy] = useState(false);
  async function genReference() {
    setGenBusy(true);
    try {
      const res = await fetch("/api/products/next-reference", { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        if (j?.reference) setForm((f) => ({ ...f, reference: j.reference }));
      }
    } finally {
      setGenBusy(false);
    }
  }
  // New product: prefill the reference automatically.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    if (!initial.id && !(initial.reference ?? "").trim()) void genReference();
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Categories & suppliers grow inline via their + buttons (no reload needed).
  const [cats, setCats] = useSyncedState<Ref[]>(categories);
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [sups, setSups] = useSyncedState<Ref[]>(suppliers);
  const [showSup, setShowSup] = useState(false);
  const [supName, setSupName] = useState("");
  const [supBusy, setSupBusy] = useState(false);

  async function createCategory() {
    const name = catName.trim();
    if (!name) return;
    const hit = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (hit) {
      set("categoryId", hit.id);
      setCatName("");
      setShowCat(false);
      return;
    }
    setCatBusy(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      const row = { id: data.id as string, name: data.name as string };
      setCats((cs) => (cs.some((c) => c.id === row.id) ? cs : [...cs, row].sort((a, b) => compareNatural(a.name, b.name, locale))));
      set("categoryId", row.id);
      setCatName("");
      setShowCat(false);
    } finally {
      setCatBusy(false);
    }
  }

  async function createSupplier() {
    const name = supName.trim();
    if (!name) return;
    const hit = sups.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (hit) {
      set("supplierId", hit.id);
      setSupName("");
      setShowSup(false);
      return;
    }
    setSupBusy(true);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      const row = { id: data.id as string, name: data.name as string };
      setSups((ss) => (ss.some((s) => s.id === row.id) ? ss : [...ss, row].sort((a, b) => compareNatural(a.name, b.name, locale))));
      set("supplierId", row.id);
      setSupName("");
      setShowSup(false);
    } finally {
      setSupBusy(false);
    }
  }

  function set<K extends keyof ProductData>(k: K, v: ProductData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "—";
  /// Smallest unit, LabStock-style free text (matched to an existing unit or
  /// created on save — replaces the old base-unit dropdown).
  const [unitText, setUnitText] = useState(
    () => (initial.baseUnitId ? (units.find((u) => u.id === initial.baseUnitId)?.name ?? "") : "")
  );
  const baseName = unitText.trim() || "…";

  /// Nested colisage builder (LabStock-simple, 3 levels max):
  ///   unite  = smallest unit only (no conversion)
  ///   simple = base + L1 (1 Carton = N x Bouteille)
  ///   double = base + L1 + L2 (1 Fardeau = M x Carton = M*N x Bouteille)
  /// Stored as conversions with factor > 1; colisage text auto-generated.
  const [colis, setColis] = useState<ColisDraft>(() =>
    draftFromConversions(initial.conversions, unitName)
  );
  const setColisK = <K extends keyof ColisDraft>(k: K, v: ColisDraft[K]) =>
    setColis((c) => ({ ...c, [k]: v }));
  const colisPreview = previewFactors(colis);

  /// Quantity ladder per colisage. Keys are builder LEVELS ("base" | "l1" |
  /// "l2" | "u:<unitId>" for legacy pieces) because new colis units get their
  /// real ids only at save; they are mapped to unit ids in submit().
  const [ladder, setLadder] = useState<LadderValue>(() => {
    const packs = initial.conversions.filter((c) => c.unitId && c.factor > 1).sort((a, b) => a.factor - b.factor);
    const l1Id = packs.length === 1 ? packs[0].unitId : packs.length >= 2 ? packs[packs.length - 2].unitId : "";
    const l2Id = packs.length >= 2 ? packs[packs.length - 1].unitId : "";
    const out: LadderValue = {};
    for (const r of [...(initial.qtyTiers ?? [])].sort((a, b) => a.minQty - b.minQty)) {
      const key = r.unitKey === "" ? "base" : r.unitKey === l1Id ? "l1" : r.unitKey === l2Id ? "l2" : `u:${r.unitKey}`;
      (out[key] ??= []).push({ minQty: r.minQty, tierId: r.tierId });
    }
    return out;
  });
  const autoColisage = useMemo(
    () => buildColisageText(baseName, colis),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseName, colis.mode, colis.l1Name, colis.l1Qty, colis.l2Name, colis.l2Qty]
  );

  /// Legacy sub-base pieces (seed model base=carton + piece 1/N) are preserved
  /// untouched; the builder only manages packs above base (factor >= 1).
  const legacyPieces = useMemo(
    () => form.conversions.filter((c) => c.unitId && c.factor > 0 && c.factor < 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial.id]
  );

  /// Preview conversions = kept packs (edited below on submit once unit ids
  /// are resolved) + legacy pieces. Preview uses provisional ids for display.
  const previewConversions = useMemo(() => {
    const rows: Array<{ unitId: string; factor: number; barcode?: string | null; label: string }> =
      legacyPieces.map((c) => ({
        unitId: c.unitId,
        factor: c.factor,
        barcode: c.barcode ?? null,
        label: unitName(c.unitId),
      }));
    if (colisPreview && colis.l1Name.trim()) {
      rows.push({
        unitId: `__l1__${colis.l1Name.trim()}`,
        factor: colisPreview.n1,
        barcode: colis.l1Barcode.trim() || null,
        label: colis.l1Name.trim(),
      });
    }
    if (colis.mode === "double" && colisPreview && colisPreview.n2 > 0 && colis.l2Name.trim()) {
      rows.push({
        unitId: `__l2__${colis.l2Name.trim()}`,
        factor: colisPreview.total,
        barcode: colis.l2Barcode.trim() || null,
        label: colis.l2Name.trim(),
      });
    }
    // Packs above base kept from the loaded product (hidden legacy packs).
    for (const c of form.conversions) {
      if (c.unitId && c.factor >= 1 && !rows.some((r) => r.unitId === c.unitId)) {
        rows.push({ unitId: c.unitId, factor: c.factor, barcode: c.barcode ?? null, label: unitName(c.unitId) });
      }
    }
    return rows.sort((a, b) => a.factor - b.factor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyPieces, colisPreview?.n1, colisPreview?.total, colis, form.conversions]);

  const t = (k: string, fallback: string) => labels[k] ?? fallback;

  /// Match a typed name to an existing unit (case-insensitive) or create it.
  /// Colisages that can carry a ladder (largest first): base + builder levels
  /// + legacy sub-base pieces.
  const ladderUnits: LadderUnit[] = [
    ...(colis.mode === "double" && colisPreview && colisPreview.n2 > 0 && colis.l2Name.trim()
      ? [{ key: "l2", label: colis.l2Name.trim(), factor: colisPreview.total }]
      : []),
    ...(colis.mode !== "unite" && colisPreview && colis.l1Name.trim()
      ? [{ key: "l1", label: colis.l1Name.trim(), factor: colisPreview.n1 }]
      : []),
    { key: "base", label: baseName, factor: 1 },
    ...legacyPieces.map((c) => ({ key: `u:${c.unitId}`, label: unitName(c.unitId), factor: c.factor })),
  ];

  async function resolveUnitId(name: string): Promise<string> {
    const needle = name.trim().toLowerCase();
    const hit = units.find((u) => u.name.toLowerCase() === needle);
    if (hit) return hit.id;
    const res = await fetch("/api/settings/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Race: unit created concurrently → reuse existing with same name.
      if (data.error === "duplicate_name") {
        const retry = units.find((u) => u.name.toLowerCase() === needle);
        if (retry) return retry.id;
      }
      throw new Error(data.error ?? "unit_create_failed");
    }
    units.push({ id: data.id, name: data.name });
    return data.id as string;
  }

  async function submit() {
    if (!form.name.trim()) {
      setError("name_required");
      return;
    }
    if (!form.supplierId) {
      setError("supplier_required");
      return;
    }
    if (!unitText.trim()) {
      setError(t("unitRequired", "unit_required"));
      return;
    }
    if (colis.mode !== "unite") {
      const n1 = Number(colis.l1Qty);
      if (!colis.l1Name.trim() || !(n1 > 0)) {
        setError(t("colisL1Required", "colis_l1_required"));
        return;
      }
      if (colis.mode === "double") {
        const n2 = Number(colis.l2Qty);
        if (!colis.l2Name.trim() || !(n2 > 0)) {
          setError(t("colisL2Required", "colis_l2_required"));
          return;
        }
      }
    }
    setBusy(true);
    setError(null);
    try {
      // Smallest unit first (typed name → unit id, created inline if new).
      const baseId = await resolveUnitId(unitText);
      // Resolve typed colis names → unit ids (create missing units inline).
      const conversions: Array<{ unitId: string; factor: number; barcode?: string | null }> =
        legacyPieces.map((c) => ({ unitId: c.unitId, factor: c.factor, barcode: c.barcode ?? null }));
      // Preserve loaded packs above base that the builder did not replace.
      const replaced = new Set<string>();
      let l1Id = "";
      let l2Id = "";
      if (colisPreview && colis.l1Name.trim()) {
        l1Id = await resolveUnitId(colis.l1Name);
        replaced.add(l1Id);
        conversions.push({
          unitId: l1Id,
          factor: colisPreview.n1,
          barcode: colis.l1Barcode.trim() ? colis.l1Barcode.trim() : null,
        });
      }
      if (colis.mode === "double" && colisPreview && colisPreview.n2 > 0 && colis.l2Name.trim()) {
        l2Id = await resolveUnitId(colis.l2Name);
        replaced.add(l2Id);
        conversions.push({
          unitId: l2Id,
          factor: colisPreview.total,
          barcode: colis.l2Barcode.trim() ? colis.l2Barcode.trim() : null,
        });
      }
      for (const c of form.conversions) {
        if (c.unitId && c.factor >= 1 && !replaced.has(c.unitId)) {
          conversions.push({ unitId: c.unitId, factor: c.factor, barcode: c.barcode ?? null });
        }
      }
      // Dedupe by unitId (builder wins).
      const byUnit = new Map<string, (typeof conversions)[number]>();
      for (const c of conversions) byUnit.set(c.unitId, c);
      const finalConversions = [...byUnit.values()];

      // Sale/purchase units are fully automatic (no selectors):
      // purchase = largest pack, sale = smallest pack (or the unit itself).
      const packIds = finalConversions.filter((c) => c.factor >= 1).sort((a, b) => a.factor - b.factor).map((c) => c.unitId);
      const largest = packIds[packIds.length - 1] ?? null;
      const smallestPack = packIds[0] ?? null;
      const saleUnitId = smallestPack ?? baseId;
      const purchaseUnitId = largest ?? baseId;

      const res = await fetch(initial.id ? `/api/products/${initial.id}` : "/api/products", {
        method: initial.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          baseUnitId: baseId,
          colisage: autoColisage ?? (form.colisage?.trim() ? form.colisage.trim() : null),
          saleUnitId,
          purchaseUnitId,
          conversions: finalConversions,
          qtyTiers: ladderUnits.flatMap((u) => {
            const rungs = ladder[u.key] ?? [];
            const unitKey = u.key === "base" ? "" : u.key === "l1" ? l1Id : u.key === "l2" ? l2Id : u.key.slice(2);
            if (rungs.length < 2 || (u.key !== "base" && !unitKey)) return [];
            return rungs.map((r, i) => ({ unitKey, minQty: i === 0 ? 0 : r.minQty, tierId: r.tierId }));
          }),
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "save_failed");
        return;
      }
      const saved = await res.json().catch(() => null);
      handleSuccess(saved?.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}

      <Card>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.name}</label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.reference}</label>
              <div className="flex gap-2">
                <Input value={form.reference ?? ""} onChange={(e) => set("reference", e.target.value)} dir="ltr" className="min-w-0 flex-1 font-mono" />
                <Button
                  type="button"
                  onClick={() => void genReference()}
                  disabled={genBusy}
                  className="shrink-0 px-3"
                  title={tp("autoGenerate")}
                  aria-label={tp("autoGenerate")}
                >
                  <Wand2 size={16} />
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.barcode}</label>
              <Input value={form.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.category}</label>
            <div className="flex gap-2">
              <select value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || null)} className={`${inputCls} min-w-0 flex-1`}>
                <option value="">{labels.noCategory}</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <Button
                type="button"
                onClick={() => { setShowCat((s) => !s); setCatName(""); }}
                className="shrink-0 px-3"
                title={t("newCategory", labels.category)}
                aria-label={t("newCategory", labels.category)}
              >
                +
              </Button>
            </div>
            {showCat && (
              <div className="mt-2 flex gap-2">
                <Input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder={t("newCategoryPh", labels.category)}
                  onKeyDown={(e) => { if (e.key === "Enter") void createCategory(); }}
                />
                <Button type="button" onClick={() => void createCategory()} disabled={catBusy || !catName.trim()} className="shrink-0 px-4">
                  {catBusy ? "…" : labels.save}
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.supplier} <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                <select value={form.supplierId ?? ""} onChange={(e) => set("supplierId", e.target.value || null)} className={`${inputCls} min-w-0 flex-1`}>
                  <option value="">—</option>
                  {sups.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={() => { setShowSup((s) => !s); setSupName(""); }}
                  className="shrink-0 px-3"
                  title={t("newSupplier", labels.supplier)}
                  aria-label={t("newSupplier", labels.supplier)}
                >
                  +
                </Button>
              </div>
              {showSup && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={supName}
                    onChange={(e) => setSupName(e.target.value)}
                    placeholder={t("newSupplierPh", labels.supplier)}
                    onKeyDown={(e) => { if (e.key === "Enter") void createSupplier(); }}
                  />
                  <Button type="button" onClick={() => void createSupplier()} disabled={supBusy || !supName.trim()} className="shrink-0 px-4">
                    {supBusy ? "…" : labels.save}
                  </Button>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.minStock}</label>
              <Input type="number" min={0} step="any" value={form.minStock} onChange={(e) => set("minStock", Number(e.target.value))} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold">{labels.images}</h2>
        <ImageUploader images={form.images} onChange={(urls) => set("images", urls)} addLabel={labels.addImages} />
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold">{t("colisageTitle", labels.conversions)}</h2>
        <div className="mb-2">
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">
            {t("unitName", "Unit")} <span className="normal-case opacity-60">← {t("smallestUnit", labels.baseUnit)}</span>
          </label>
          <input
            value={unitText}
            onChange={(e) => setUnitText(e.target.value)}
            list="product-base-units"
            placeholder={t("unitNamePh", "علبة…")}
            className={inputCls}
          />
          <datalist id="product-base-units">
            {units.map((u) => (
              <option key={u.id} value={u.name} />
            ))}
          </datalist>
        </div>

        {/* Product kind: unite / colisage / colisage-in-colisage */}
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ["unite", t("kindUnite", "Unité")],
              ["simple", t("kindColis", "Colisage")],
              ["double", t("kindDouble", "Colis × Colis")],
            ] as Array<[ColisMode, string]>
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setColisK("mode", m)}
              className={`min-h-11 rounded-lg border px-1 text-xs font-black leading-tight transition-colors ${
                colis.mode === m
                  ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                  : "border-(--border-default) opacity-70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {colis.mode !== "unite" && (
          <div className="grid gap-2 rounded-lg border border-(--border-subtle) p-2">
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase opacity-60">
                  {t("colisName", "Nom du colisage")}
                </label>
                <input
                  value={colis.l1Name}
                  onChange={(e) => setColisK("l1Name", e.target.value)}
                  list="colisage-units-l1"
                  placeholder={t("colisNamePh", "Carton…")}
                  className={inputCls}
                />
                <datalist id="colisage-units-l1">
                  {units.map((u) => (
                    <option key={u.id} value={u.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase opacity-60">
                  {t("qtyPer", "Qté")} ({baseName})
                </label>
                <Input
                  type="number" min={0} step="any" value={colis.l1Qty}
                  onChange={(e) => setColisK("l1Qty", e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        )}

        {colis.mode === "double" && (
          <div className="mt-2 grid gap-2 rounded-lg border border-(--border-subtle) p-2">
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase opacity-60">
                  {t("surColisName", "Nom du sur-colisage")}
                </label>
                <input
                  value={colis.l2Name}
                  onChange={(e) => setColisK("l2Name", e.target.value)}
                  list="colisage-units-l2"
                  placeholder={t("surColisNamePh", "Fardeau / Palette…")}
                  className={inputCls}
                />
                <datalist id="colisage-units-l2">
                  {units.map((u) => (
                    <option key={u.id} value={u.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase opacity-60">
                  {t("qtyPerL1", "Qté")} ({colis.l1Name.trim() || "…"})
                </label>
                <Input
                  type="number" min={0} step="any" value={colis.l2Qty}
                  onChange={(e) => setColisK("l2Qty", e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        )}

        {/* Live preview: 1 Carton = 24 Bouteille / 1 Fardeau = 10 Carton = 240 */}
        {colisPreview && colis.l1Name.trim() && (
          <div className="mt-2 rounded-lg bg-(--brand-500)/10 px-3 py-2 text-xs font-black text-(--brand-600)">
            1 {colis.l1Name.trim()} = {dz(colisPreview.n1)} {baseName}
            {colis.mode === "double" && colisPreview.n2 > 0 && colis.l2Name.trim() && (
              <> · 1 {colis.l2Name.trim()} = {dz(colisPreview.n2)} {colis.l1Name.trim()} = {dz(colisPreview.total)} {baseName}</>
            )}
          </div>
        )}
        {legacyPieces.length > 0 && (
          <p className="mt-2 text-[11px] opacity-60">
            {t("legacyPieces", "Legacy detail units kept")}:{" "}
            {legacyPieces.map((c) => unitName(c.unitId)).join(", ")}
          </p>
        )}
        <div className="mt-2 space-y-1">
          {previewConversions.filter((c) => c.factor >= 1).map((c) => (
            <div key={c.unitId} className="flex items-center justify-between rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-xs font-bold">
              <span>{c.label}</span>
              <span className="tabular-nums opacity-70">×{dz(c.factor)} {baseName}</span>
            </div>
          ))}
        </div>
        {/* Sale/purchase units are automatic: sale = smallest colis (or the
            unit itself), purchase = largest colis. No selectors needed. */}
      </Card>

      {/* Prices (per smallest colis, like a purchase — stored per base unit).
          Entered at creation with stock 0, editable anytime later. Enter
          prices AFTER the colisage above: they convert with its factor. */}
      <Card>
        <h2 className="mb-2 text-sm font-bold">{labels.tierPrices}</h2>
        {(() => {
          const pack = previewConversions.filter((c) => c.factor >= 1).sort((a, b) => a.factor - b.factor)[0] ?? null;
          const pf = pack?.factor ?? 1;
          const plabel = pack?.label ?? baseName;
          const r2 = (v: number) => Math.round(v * 100) / 100;
          // Dual price entry: type the piece price OR the colis price —
          // both derive from the same base value, so each updates the other.
          const dualInput = (
            get: number,
            setBase: (base: number) => void,
          ) => (
            <div className="flex shrink-0 items-center gap-1" dir="ltr">
              <input
                type="number"
                min={0}
                step="any"
                value={get ? r2(get) || "" : ""}
                placeholder={baseName}
                title={baseName}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setBase(v == null || Number.isNaN(v) ? 0 : v);
                }}
                className="h-11 w-20 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-end font-black tabular-nums outline-none focus:border-(--brand-500)"
              />
              <span className="text-xs opacity-40">/</span>
              <input
                type="number"
                min={0}
                step="any"
                value={get ? r2(get * pf) || "" : ""}
                placeholder={plabel}
                title={plabel}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setBase(v == null || Number.isNaN(v) ? 0 : v / pf);
                }}
                className="h-11 w-24 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-end font-black tabular-nums outline-none focus:border-(--brand-500)"
              />
            </div>
          );
          return (
            <>
              {/* Whole colis prices (what the user buys/sells with) — per-base
                  fractions like 0.33/0.5 are never entered, only derived. */}
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">{labels.costPrice}</span>
                {dualInput(form.costPrice, (base) => setForm((f) => ({ ...f, costPrice: base })))}
              </div>
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-(--brand-500)/10 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">{labels.salePrice}</span>
                {dualInput(form.salePrice, (base) => setForm((f) => ({ ...f, salePrice: base })))}
              </div>
              {tiers.map((tier) => {
                const row = form.tierPrices.find((t) => t.tierId === tier.id);
                return (
                  <div key={tier.id} className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-semibold">{tier.name}</span>
                    {dualInput(row ? row.price : 0, (base) => {
                      setForm((f) => {
                        const rest = f.tierPrices.filter((t) => t.tierId !== tier.id);
                        if (!base) return { ...f, tierPrices: rest };
                        return { ...f, tierPrices: [...rest, { tierId: tier.id, price: base }] };
                      });
                    })}
                  </div>
                );
              })}
            </>
          );
        })()}
      </Card>

      {/* Quantity pricing: per colisage, which tier price applies from which quantity. */}
      <Card>
        <h2 className="mb-2 text-sm font-bold">{tp("ladderTitle")}</h2>
        <QtyLadder
          units={ladderUnits}
          tiers={tiers}
          baseLabel={labels.salePrice}
          priceOfTier={(id) => resolveTierPrice(form.tierPrices, form.salePrice, id)}
          hasTierPrice={(id) => form.tierPrices.some((x) => x.tierId === id && x.price > 0)}
          value={ladder}
          onChange={setLadder}
        />
      </Card>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleClose} className="flex-1">
          {labels.cancel}
        </Button>
        <Button onClick={submit} disabled={busy} className="flex-[2]">
          {labels.save}
        </Button>
      </div>
    </div>
  );
}
