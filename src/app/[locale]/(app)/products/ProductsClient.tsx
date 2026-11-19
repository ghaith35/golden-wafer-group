"use client";

import { useEffect, useState } from "react";
import { Boxes, PackageX, Plus, Pencil, Trash2, Upload, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/ui/RowActions";
import { ProductGallery } from "@/components/products/ProductGallery";
import { packBreakdown, priceForUnit, showColisage } from "@/components/products/UnitQty";
import { levelLabel } from "@/lib/products/colisage";
import { ProductCardDetails } from "@/components/products/ProductCardDetails";
import { KpiCard } from "@/components/ui/Card";
import { ProductForm, type ProductData, type Ref } from "./ProductForm";
import { ProductImportModal } from "./ProductImportModal";
import { cn } from "@/lib/utils";
import { dz, dzMoney } from "@/lib/format";
import { useSyncedState } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
type Row = {
  id: string;
  name: string;
  reference: string | null;
  barcode: string | null;
  stockQty: unknown;
  salePrice: unknown;
  costPrice: unknown;
  colisage: string | null;
  isActive: boolean;
  images: Array<{ url: string }>;
  category: { name: string } | null;
  baseUnit: { name: string } | null;
  conversions: Array<{ unitId: string; factor: number; unit: { name: string } }>;
  tierPrices: Array<{ price: unknown; tier: { name: string } }>;
};

type Full = ProductData & {
  id: string;
  name: string;
  stockQty: number;
  categoryName: string | null;
  supplierName: string | null;
  baseUnitName: string | null;
  stock: { qty: number; cump: number; value: number } | null;
};

const EMPTY: ProductData = { name: "", minStock: 0, salePrice: 0, costPrice: 0, images: [], conversions: [], tierPrices: [], saleUnitId: null, purchaseUnitId: null };

type ViewMode = "list" | "grid-2" | "grid-3" | "grid-4" | "grid-5";
const VIEW_KEY = "distribuili-products-view";
const VIEW_MODES: Array<{ v: ViewMode; label: string }> = [
  { v: "list", label: "☰" },
  { v: "grid-2", label: "2" },
  { v: "grid-3", label: "3" },
  { v: "grid-4", label: "4" },
  { v: "grid-5", label: "5" },
];
const GRID_CLS: Record<Exclude<ViewMode, "list">, string> = {
  "grid-2": "grid grid-cols-2 gap-3",
  "grid-3": "grid grid-cols-2 gap-3 sm:grid-cols-3",
  "grid-4": "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4",
  "grid-5": "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
};

export function ProductsClient({
  locale,
  initial,
  stockById,
  depotById,
  vanById,
  categories,
  suppliers,
  units,
  tiers,
  labels,
}: {
  locale: string;
  initial: Row[];
  stockById: Record<string, { qty: number; cump: number; value: number }>;
  depotById: Record<string, number>;
  vanById: Record<string, number>;
  categories: Array<{ id: string; name: string }>;
  suppliers: Ref[];
  units: Ref[];
  tiers: Ref[];
  labels: Record<string, string>;
}) {
  const [rows, setRows] = useSyncedState(initial);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  // Catalog-only: stock lives in the inventory section, not on product cards.
  // Start with the server-matching default, then apply the saved appearance.
  const [view, setView] = useState<ViewMode>("grid-3");

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as ViewMode | null;
      if (v && VIEW_MODES.some((m) => m.v === v)) setView(v);
    } catch { /* private mode */ }
  }, []);

  function pickView(v: ViewMode) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch { /* private mode */ }
  }
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProductData | null>(null);
  const [details, setDetails] = useState<Full | null>(null);
  const [deleting, setDeleting] = useState<Row | { id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function reload() {
    const res = await fetch("/api/products");
    if (res.ok) setRows(await res.json());
  }

  async function loadFull(id: string): Promise<Full | null> {
    setError(null);
    const res = await fetch(`/api/products/${id}`);
    if (!res.ok) {
      setError("load_failed");
      return null;
    }
    const p = await res.json();
    const unitName = (uid: string | null) => units.find((u) => u.id === uid)?.name ?? "—";
    return {
      id: p.id,
      name: p.name ?? "",
      reference: p.reference ?? null,
      barcode: p.barcode ?? null,
      colisage: p.colisage ?? null,
      categoryId: p.categoryId ?? null,
      supplierId: p.supplierId ?? null,
      baseUnitId: p.baseUnitId ?? null,
      saleUnitId: p.saleUnitId ?? null,
      purchaseUnitId: p.purchaseUnitId ?? null,
      minStock: Number(p.minStock ?? 0),
      salePrice: Number(p.salePrice ?? 0),
      costPrice: Number(p.costPrice ?? 0),
      stockQty: Number(p.stockQty ?? 0),
      stock: p.stock
        ? { qty: Number(p.stock.qty), cump: Number(p.stock.cump), value: Number(p.stock.value) }
        : null,
      categoryName: p.category?.name ?? categories.find((c) => c.id === p.categoryId)?.name ?? null,
      supplierName: p.supplier?.name ?? suppliers.find((s) => s.id === p.supplierId)?.name ?? null,
      baseUnitName: unitName(p.baseUnitId ?? null),
      images: (p.images ?? []).map((i: { url: string }) => i.url),
      conversions: (p.conversions ?? []).map((c: { unitId: string; factor: unknown; barcode?: string | null }) => ({ unitId: c.unitId, factor: Number(c.factor), barcode: c.barcode ?? null })),
      tierPrices: (p.tierPrices ?? []).map((x: { tierId: string; price: unknown }) => ({ tierId: x.tierId, price: Number(x.price) })),
    };
  }

  async function openDetails(row: { id: string }) {
    const full = await loadFull(row.id);
    if (full) setDetails(full);
  }

  async function openEdit(id: string) {
    const full = await loadFull(id);
    if (full) {
      setDetails(null);
      setEditing(full);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/products/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "delete_failed");
      return;
    }
    setDeleting(null);
    setDetails(null);
    await reload();
  }

  const filtered = rows.filter(
    (p) =>
      (!cat || p.category?.name === categories.find((c) => c.id === cat)?.name) &&
      (!q || p.name.includes(q) || (p.barcode ?? "").includes(q) || (p.reference ?? "").includes(q))
  );

  const formLabels = {
    name: labels.name, reference: labels.reference, barcode: labels.barcode, colisage: labels.colisage,
    category: labels.category, noCategory: labels.noCategory, supplier: labels.supplier, baseUnit: labels.baseUnit,
    salePrice: labels.salePrice, costPrice: labels.costPrice, minStock: labels.minStock,
    images: labels.images, addImages: labels.addImages, conversions: labels.conversions,
    factorHint: labels.factorHint, tierPrices: labels.tierPrices, save: labels.save, cancel: labels.cancel,
    saleUnit: labels.saleUnit, purchaseUnit: labels.purchaseUnit,
    pieceUnit: labels.pieceUnit, piecesPerPack: labels.piecesPerPack,
    newCategory: labels.newCategory, newCategoryPh: labels.newCategoryPh,
    unitName: labels.unitName, unitNamePh: labels.unitNamePh, unitRequired: labels.unitRequired,
    newSupplier: labels.newSupplier, newSupplierPh: labels.newSupplierPh,
  };
  const actionLabels = { details: labels.details, edit: labels.edit, delete: labels.delete };
  const tierName = (id: string) => tiers.find((x) => x.id === id)?.name ?? id;
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "—";
  const ladder = (p: Row) => (
    <ProductCardDetails
      stockQty={Number(p.stockQty)}
      depotQty={depotById[p.id] ?? 0}
      depotLabel={labels.depot ?? "depot"}
      vanQty={vanById[p.id] ?? 0}
      vanLabel={labels.trucks ?? "trucks"}
      costPrice={Number(p.costPrice ?? 0)}
      salePrice={Number(p.salePrice)}
      tiers={(p.tierPrices ?? []).map((x) => ({ name: x.tier.name, price: Number(x.price) }))}
      conversions={(p.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: Number(c.factor), unitName: c.unit.name }))}
      baseName={p.baseUnit?.name ?? ""}
      cump={stockById[p.id] ?? null}
      costLabel={labels.costPrice}
      saleLabel={labels.salePrice}
      cumpLabel={labels.cump}
      valueLabel={labels.stockValue}
      marginLabel={labels.margin}
      colisage={p.colisage}
    />
  );

  return (
    <div className="flex flex-col space-y-4 p-5 md:p-6 lg:h-[calc(var(--vh)-3.5rem)] lg:overflow-hidden lg:pb-4">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <KpiCard
          label={labels.title}
          value={String(rows.length)}
          icon={<Boxes size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
        <KpiCard
          label={labels.stockValue}
          value={dzMoney(Object.values(stockById).reduce((s, e) => s + Number(e.value ?? 0), 0))}
          icon={<Wallet size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact
        />
        <KpiCard
          label={labels.alerts}
          value={String(rows.filter((p) => Number(p.stockQty ?? 0) <= 0).length)}
          icon={<PackageX size={18} />}
          accent="bg-amber-500/15 text-amber-600"
          compact
        />
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 lg:flex-1">
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <Plus size={16} className="me-1" />
            {labels.neW}
          </Button>
          <Button onClick={() => setImporting(true)} variant="secondary" className="shrink-0">
            <Upload size={16} className="me-1" />
            {labels.import}
          </Button>
          <div className="min-w-40 flex-1">
            <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="h-11 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm"
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="flex shrink-0 items-center gap-1 rounded-xl bg-(--bg-sunken) p-1" role="group" aria-label="view">
          {VIEW_MODES.map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => pickView(m.v)}
              aria-pressed={view === m.v}
              aria-label={m.v}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                view === m.v ? "bg-(--bg-overlay) shadow" : "opacity-50"
              )}
            >
              {m.label}
            </button>
          ))}
          </div>
        </div>
      </div>
      {view === "list" ? (
        <div className="min-h-0 space-y-2 lg:flex-1 lg:overflow-y-auto lg:pb-2">
          {filtered.map((p) => (
            <div
              key={p.id}
              onClick={() => void openDetails(p)}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5 transition-colors hover:border-(--brand-500)"
              style={p.isActive ? undefined : { opacity: 0.55 }}
            >
              <ProductGallery images={p.images.map((i) => i.url)} alt={p.name} className="h-14 w-20 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{p.name}</div>
                <div className="truncate text-xs opacity-60">
                  {p.reference ?? ""} {p.category?.name ?? labels.noCategory}
                </div>
                <div className="truncate text-[11px] font-bold text-(--brand-600)">
                  {packBreakdown(Number(p.stockQty), p.conversions ?? [], unitName, p.baseUnit?.name ?? "—")}
                </div>
              </div>
              <span className="shrink-0 text-sm font-black">{String(p.salePrice)}</span>
              <RowActions
                onDetails={() => void openDetails(p)}
                onEdit={() => void openEdit(p.id)}
                onDelete={() => setDeleting(p)}
                labels={actionLabels}
              />
            </div>
          ))}
        </div>
      ) : (
      <div className={cn(GRID_CLS[view], "min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-2")}>
        {filtered.map((p) => (
          <div
            key={p.id}
            onClick={() => void openDetails(p)}
            className="cursor-pointer rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-colors hover:border-(--brand-500)"
            style={p.isActive ? undefined : { opacity: 0.55 }}
          >
            <ProductGallery images={p.images.map((i) => i.url)} alt={p.name} className="mb-2 aspect-video w-full" />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{p.name}</div>
                <div className="text-xs opacity-60">
                  {p.reference ?? ""} {p.category?.name ?? labels.noCategory}
                </div>
              </div>
              <RowActions
                onDetails={() => void openDetails(p)}
                onEdit={() => void openEdit(p.id)}
                onDelete={() => setDeleting(p)}
                labels={actionLabels}
              />
            </div>
            <div className="mt-2 border-t border-(--border-subtle) pt-2">{ladder(p)}</div>
          </div>
        ))}
      </div>
      )}

      {/* Details popup (no more page redirect) */}
      <Modal open={details !== null} onClose={() => setDetails(null)} title={details?.name ?? ""} subtitle={details?.reference ?? ""} icon="📄">
        {details && (
          <div className="space-y-4">
            <ProductGallery images={details.images} alt={details.name} className="aspect-video w-full" />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Info label={labels.barcode} value={details.barcode ?? "—"} mono />
              <Info label={labels.colisage} value={showColisage(details.colisage) ? details.colisage! : "—"} />
              <Info label={labels.category} value={details.categoryName ?? labels.noCategory} />
              <Info label={labels.supplier} value={details.supplierName ?? "—"} />
              <Info label={labels.baseUnit} value={details.baseUnitName ?? "—"} />
              <div className="col-span-2 rounded-lg bg-(--bg-sunken) px-3 py-2">
                <div className="text-[10px] font-bold uppercase opacity-60">{labels.stock}</div>
                <div className="truncate text-sm font-black text-(--brand-600)">
                  {packBreakdown(details.stock?.qty ?? details.stockQty, details.conversions, unitName, details.baseUnitName ?? "")}
                </div>
              </div>
              {(() => {
                // Colis product: whole prices per smallest colis (L1), never
                // per-base fractions like 85.5.
                const l1 = [...details.conversions]
                  .filter((c) => c.factor > 1)
                  .sort((a, b) => a.factor - b.factor)[0];
                if (!l1) {
                  return (
                    <>
                      <Info label={labels.salePrice} value={String(details.salePrice)} strong />
                      <Info label={labels.costPrice} value={String(details.costPrice)} />
                    </>
                  );
                }
                const per = (v: number) =>
                  priceForUnit(v, l1.factor).toLocaleString(undefined, { maximumFractionDigits: 2 });
                const suffix = ` / ${unitName(l1.unitId)}`;
                return (
                  <>
                    <Info label={`${labels.salePrice}${suffix}`} value={per(details.salePrice)} strong />
                    <Info label={`${labels.costPrice}${suffix}`} value={per(details.costPrice)} />
                  </>
                );
              })()}
              <Info label={labels.minStock} value={String(details.minStock)} />
            </div>
            {details.tierPrices.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase opacity-60">{labels.tierPrices}</div>
                <div className="space-y-1">
                  {(() => {
                    const l1 = [...details.conversions]
                      .filter((c) => c.factor > 1)
                      .sort((a, b) => a.factor - b.factor)[0];
                    return details.tierPrices.map((x) => (
                      <div key={x.tierId} className="flex justify-between rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-sm">
                        <span className="font-semibold">
                          {tierName(x.tierId)}{l1 ? ` / ${unitName(l1.unitId)}` : ""}
                        </span>
                        <span className="font-black">
                          {l1
                            ? priceForUnit(x.price, l1.factor).toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : x.price}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
            {details.stock && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase opacity-60">{labels.stock}</div>
                <div className="rounded-xl bg-(--bg-sunken) px-3 py-2.5">
                  <StockBreakdown
                    qty={details.stock.qty}
                    conversions={details.conversions}
                    unitName={unitName}
                    baseName={details.baseUnitName ?? "—"}
                  />
                  <div className="mt-2 space-y-1 border-t border-(--border-default) pt-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-semibold opacity-60">{labels.cump}</span>
                      <span className="font-black tabular-nums" dir="ltr">{dzMoney(details.stock.cump)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold opacity-60">{labels.stockValue}</span>
                      <span className="font-black tabular-nums text-(--brand-600)" dir="ltr">{dzMoney(details.stock.value)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold opacity-60">{labels.margin}</span>
                      <span className={`font-black tabular-nums ${details.salePrice - details.stock.cump >= 0 ? "text-(--brand-600)" : "text-red-500"}`} dir="ltr">
                        {dzMoney(details.salePrice - details.stock.cump)}
                        {details.stock.cump > 0 ? <bdi> ({dz(Math.round(((details.salePrice - details.stock.cump) / details.stock.cump) * 100))}%)</bdi> : ""}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {details.conversions.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-bold uppercase opacity-60">{labels.conversions}</div>
                <div className="space-y-1">
                  {(() => {
                    const base = details.baseUnitName ?? "—";
                    const asc = [...details.conversions].sort((a, b) => a.factor - b.factor);
                    const levels = asc.map((c) => ({ name: unitName(c.unitId), factor: c.factor }));
                    return [...asc]
                      .map((c, i) => ({ c, i }))
                      .reverse()
                      .map(({ c, i }) => (
                        <div key={c.unitId} className="flex justify-between rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-sm">
                          <span className="font-semibold">{levelLabel(levels, i, base)}</span>
                          <span className="font-black tabular-nums">{dzMoney(priceForUnit(details.salePrice, c.factor))}</span>
                        </div>
                      ));
                  })()}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => setDeleting({ id: details.id, name: details.name })} className="flex-1">
                <Trash2 size={15} className="me-1" />
                {labels.delete}
              </Button>
              <Button onClick={() => void openEdit(details.id)} className="flex-[2]">
                <Pencil size={15} className="me-1" />
                {labels.edit}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title={labels.neW} subtitle={labels.title} icon="+" width="lg">
        <ProductForm
          key="new"
          locale={locale}
          initial={EMPTY}
          categories={categories}
          suppliers={suppliers}
          units={units}
          tiers={tiers}
          labels={formLabels}
          onSuccess={() => {
            setCreating(false);
            void reload();
          }}
          onClose={() => setCreating(false)}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.name ?? ""} subtitle={labels.title} icon="✎" width="lg">
        {editing && (
          <ProductForm
            key={editing.id}
            locale={locale}
            initial={editing}
            categories={categories}
            suppliers={suppliers}
            units={units}
            tiers={tiers}
            labels={formLabels}
            onSuccess={() => {
              setEditing(null);
              void reload();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={labels.deleteTitle}
        message={deleting ? labels.deleteMessage.replace("{name}", deleting.name) : ""}
      />

      <ProductImportModal
        open={importing}
        onClose={() => setImporting(false)}
        onDone={() => void reload()}
        labels={labels}
      />
    </div>
  );
}

/// Grossiste breakdown through every pack level: "1 منصة + 20 فاردو"
/// (never fractional like "1.67 منصة").
function StockBreakdown({
  qty,
  conversions,
  unitName,
  baseName,
}: {
  qty: number;
  conversions: Array<{ unitId: string; factor: number }>;
  unitName: (id: string) => string;
  baseName: string;
}) {
  const packs = [...conversions].filter((c) => c.factor > 1).sort((a, b) => b.factor - a.factor);
  if (packs.length === 0) {
    return (
      <div className="text-lg font-black tabular-nums">
        {qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm">{baseName}</span>
      </div>
    );
  }
  let rest = Math.round(qty * 1000) / 1000;
  const parts: Array<{ count: number; name: string }> = [];
  for (const pack of packs) {
    const count = Math.floor(rest / pack.factor + 1e-9);
    if (count > 0) {
      parts.push({ count, name: unitName(pack.unitId) });
      rest = Math.round((rest - count * pack.factor) * 1000) / 1000;
    }
  }
  return (
    <div className="text-lg font-black tabular-nums">
      {parts.length > 0 ? (
        parts.map((pt, i) => (
          <span key={i}>
            {i > 0 && " + "}
            {pt.count.toLocaleString()} <span className="text-sm">{pt.name}</span>
          </span>
        ))
      ) : (
        <>0 <span className="text-sm">{packs[0] ? unitName(packs[0].unitId) : baseName}</span></>
      )}
      {rest > 0 && (
        <>
          {parts.length > 0 && " + "}{rest.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm">{baseName}</span>
        </>
      )}
      <div className="text-xs font-bold opacity-60">
        = {qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} {baseName}
      </div>
    </div>
  );
}

function Info({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-(--bg-sunken) px-3 py-2">
      <div className="text-[10px] font-bold uppercase opacity-60">{label}</div>
      <div className={`truncate text-sm ${strong ? "font-black" : "font-semibold"} ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
