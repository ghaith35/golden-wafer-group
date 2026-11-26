"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, ListChecks, Plus } from "lucide-react";
import { imageToWebp } from "@/lib/images/toWebp";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ProductForm } from "../products/ProductForm";
import { PackInfo, factorOf, baseNameOf, describePack } from "@/components/products/UnitQty";
import { ProductPicker } from "@/components/products/ProductPicker";
import { breakdownNested } from "@/lib/products/colisage";
import { compareNatural } from "@/lib/sort";
import { dzMoney } from "@/lib/format";
import { useSyncedState } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
export type SupplierOpt = { id: string; name: string };
export type ProductOpt = {
  id: string;
  name: string;
  colisage?: string | null;
  barcode?: string | null;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  purchaseUnitId: string | null;
  supplierId?: string | null;
  conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { id: string; name: string } }>;
  costPrice: number;
  salePrice: number;
  stockQty: number;
  images: Array<{ url: string }>;
  tierPrices: Array<{ tierId: string; price: number }>;
};

export type Line = {
  productId: string;
  unitId: string;
  qty: number;
  freeQty: number;
  /// Empty until typed IN the purchase (or prefilled from the product on
  /// select, converted to the line unit).
  unitPrice: number | "";
  salePrice: number | "";
  tierPrices: Record<string, number | "">;
  remise: number;
  expiryDate: string;
};

export type PurchaseInitialLine = {
  productId: string;
  unitId?: string | null;
  qty: number;
  freeQty?: number | null;
  unitPrice: number;
  remise?: number | null;
  expiryDate?: string | null;
};

export type PurchaseInitial = {
  supplierId: string;
  locationId?: string | null;
  date?: string | null;
  remise?: number | null;
  notes?: string | null;
  invoiceImageUrl?: string | null;
  lines: PurchaseInitialLine[];
};

const blankLine = (): Line => ({ productId: "", unitId: "", qty: 1, freeQty: 0, unitPrice: "", salePrice: "", tierPrices: {}, remise: 0, expiryDate: "" });

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

/// Row content for the shared picker: single pack equivalence + stock + cost.
/// Free-text colisage ("كرتون 24") only shows when there is no structured
/// pack to describe — never both ("1 كرتون = 24 قطعة" wins).
function PurchaseRowMeta({ x }: { x: ProductOpt }) {
  const pack = (x.conversions ?? [])
    .filter((c) => Number(c.factor) > 1)
    .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] opacity-60">
      {pack ? (
        <bdi className="shrink-0 font-bold text-(--brand-600)">
          {describePack(pack.unit.name, Number(pack.factor), x.baseUnit?.name ?? "")}
        </bdi>
      ) : (
        x.colisage && <bdi className="truncate">{x.colisage}</bdi>
      )}
      <bdi className="shrink-0 tabular-nums">{x.stockQty} {x.baseUnit?.name ?? ""}</bdi>
    </span>
  );
}

export function PurchaseForm({
  locale,
  suppliers: initialSuppliers,
  products,
  units,
  tiers,
  locations,
  categories,
  productLabels,
  remiseEnabled,
  expiryEnabled,
  multiDepot,
  supplierFilter = true,
  labels,
  editingId,
  initial,
  onSuccess,
  onClose,
}: {
  locale: string;
  suppliers: SupplierOpt[];
  products: ProductOpt[];
  units?: Array<{ id: string; name: string }>;
  tiers: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; kind: string }>;
  categories: Array<{ id: string; name: string }>;
  productLabels: Record<string, string>;
  remiseEnabled: boolean;
  expiryEnabled: boolean;
  multiDepot: boolean;
  /// Admin setting: when on (default), the picker shows only the chosen
  /// supplier's products; when off, all products always.
  supplierFilter?: boolean;
  labels: Record<string, string>;
  /// Full-modify mode: prefill from an existing invoice, PATCH on save.
  editingId?: string | null;
  initial?: PurchaseInitial | null;
  onSuccess?: () => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const goList = () => {
    router.push(`/${locale}/purchases`);
    router.refresh();
  };
  const handleSuccess = onSuccess ?? goList;
  const handleClose = onClose ?? goList;
  // Purchases always land in the main depot — never silently default to a van.
  // With no depot yet this stays empty, the form posts null, and the server
  // creates the depot itself (see createPurchase/updatePurchase).
  const mainDepot = locations.find((l) => l.kind === "DEPOT")?.id ?? "";
  const showLocation = multiDepot && locations.length > 1;
  const [suppliers, setSuppliers] = useSyncedState(initialSuppliers);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [showSupplier, setShowSupplier] = useState(false);
  const [supName, setSupName] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supBusy, setSupBusy] = useState(false);
  const [locationId, setLocationId] = useState(initial?.locationId ?? mainDepot);
  const [date, setDate] = useState(() => (initial?.date ? String(initial.date).slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [invoiceRemise, setInvoiceRemise] = useState(initial?.remise ?? 0);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  /// Optional photo of the supplier's paper invoice (converted to WebP).
  const [invoiceImage, setInvoiceImage] = useState<string | null>(initial?.invoiceImageUrl ?? null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgErr, setImgErr] = useState(false);

  async function pickInvoiceImage(f: File | undefined) {
    if (!f) return;
    setImgBusy(true);
    setImgErr(false);
    try {
      const webp = await imageToWebp(f);
      const form = new FormData();
      form.append("file", webp);
      form.append("dir", "invoices");
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      if (!res.ok) throw new Error("upload_failed");
      setInvoiceImage((await res.json()).url as string);
    } catch {
      setImgErr(true);
    } finally {
      setImgBusy(false);
    }
  }
  /// Amount handed to the supplier with this invoice (create only).
  /// Defaults to pay-all and follows the total until typed manually.
  const [paid, setPaid] = useState<number | "">("");
  const [paidTouched, setPaidTouched] = useState(false);
  const [lines, setLines] = useState<Line[]>(() =>
    initial && initial.lines.length
      ? initial.lines.map((x) => ({
          productId: x.productId,
          unitId: x.unitId ?? "",
          qty: x.qty,
          freeQty: x.freeQty ?? 0,
          unitPrice: x.unitPrice,
          salePrice: "" as const,
          tierPrices: {},
          remise: x.remise ?? 0,
          expiryDate: x.expiryDate ? String(x.expiryDate).slice(0, 10) : "",
        }))
      : [blankLine()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProduct, setShowProduct] = useState(false);
  /// Products created inline via the + popup, merged ahead of the list.
  const [extra, setExtra] = useState<ProductOpt[]>([]);
  const allProducts = useMemo(() => {
    const seen = new Set<string>();
    return [...extra, ...products].filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }, [extra, products]);
  /// Picker options follow the chosen supplier (their products only) when
  /// the admin filter is on. Already-added lines stay visible so their
  /// cards keep rendering.
  const pickerProducts = useMemo(() => {
    if (!supplierId || !supplierFilter) return allProducts;
    const lineIds = new Set(lines.map((l) => l.productId));
    return allProducts.filter((p) => p.supplierId === supplierId || lineIds.has(p.id));
  }, [allProducts, supplierId, supplierFilter, lines]);
  /// This supplier's catalog for the bulk-add panel.
  const supplierProducts = useMemo(
    () => (supplierId ? allProducts.filter((p) => p.supplierId === supplierId) : []),
    [allProducts, supplierId]
  );
  /// Bulk panel list follows the admin filter switch: supplier-only when
  /// filtering is on, the whole catalog when off.
  const bulkList = supplierFilter && supplierId ? supplierProducts : allProducts;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkChecked, setBulkChecked] = useState<Set<string>>(new Set());

  const productUnits = (p: ProductOpt | undefined) => {
    if (!p) return [];
    const list = [{ id: p.baseUnitId ?? "", name: p.baseUnit?.name ?? "—", factor: 1 }];
    for (const c of p.conversions) list.push({ id: c.unitId, name: c.unit.name, factor: c.factor });
    return list.filter((u) => u.id).sort((a, b) => a.factor - b.factor);
  };
  /// Buy-with-colisage: when packs exist above base, the loose base unit is
  /// not buyable — purchase happens in colis levels only, so prices stay
  /// whole per colis (never fractional per-piece like 0.33 / 0.5).
  const buyableUnits = (p: ProductOpt | undefined) => {
    const all = productUnits(p);
    return all.some((u) => u.factor > 1) ? all.filter((u) => u.factor > 1) : all;
  };
  /// Shared grid template for the column header + every line row: identical
  /// columns = header labels always sit exactly over their cells
  /// (product | qty | unit | price | sale | tiers… | total | ✕).
  const lineCols = `minmax(10rem,1fr) 5rem 6rem 7rem 7rem${
    tiers.length ? ` repeat(${tiers.length}, 6rem)` : ""
  } 6rem 2rem`;
  const totals = useMemo(() => {
    const linesTotal = lines.reduce((s, l) => s + Math.max(0, l.qty * Number(l.unitPrice || 0) - l.remise), 0);
    return { linesTotal, total: Math.max(0, linesTotal - invoiceRemise) };
  }, [lines, invoiceRemise]);

  // Default pay-all: track the total until the buyer types a custom amount.
  useEffect(() => {
    if (!paidTouched) setPaid(totals.total);
  }, [totals.total, paidTouched]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  /// Switching the purchase unit keeps the same per-base value: every price
  /// (cost, sale, tiers) auto-converts proportionally — type the price once,
  /// in any level (piece or colis).
  function switchUnit(i: number, nextUnitId: string) {
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const p = allProducts.find((x) => x.id === l.productId);
        const oldF = p ? factorOf(p, l.unitId) : 1;
        const nextF = p ? factorOf(p, nextUnitId) : 1;
        const conv = (v: number | "") => {
          const cur = Number(v || 0);
          return oldF > 0 && nextF > 0 && oldF !== nextF && cur > 0
            ? Math.round((cur / oldF) * nextF * 1000) / 1000
            : v;
        };
        const tiers: Record<string, number | ""> = {};
        for (const [k, v] of Object.entries(l.tierPrices)) tiers[k] = conv(v);
        return { ...l, unitId: nextUnitId, unitPrice: conv(l.unitPrice), salePrice: conv(l.salePrice), tierPrices: tiers };
      })
    );
  }

  /// Blank line for a product (default purchase unit + prices prefilled
  /// from the product, converted to the line unit). Shared by single pick
  /// and bulk add so both behave identically.
  function lineForProduct(np: ProductOpt): Line {
    const allowed = buyableUnits(np);
    const def = np.purchaseUnitId && allowed.some((u) => u.id === np.purchaseUnitId)
      ? np.purchaseUnitId
      : (allowed[allowed.length - 1]?.id ?? np.baseUnitId ?? "");
    const f = factorOf(np, def) || 1;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const tiers: Record<string, number | ""> = {};
    for (const t of np.tierPrices ?? []) {
      const v = r3(Number(t.price ?? 0) * f);
      if (v > 0) tiers[t.tierId] = v;
    }
    return {
      productId: np.id,
      unitId: def,
      qty: 1,
      freeQty: 0,
      unitPrice: Number(np.costPrice ?? 0) > 0 ? r3(Number(np.costPrice ?? 0) * f) : "",
      salePrice: Number(np.salePrice ?? 0) > 0 ? r3(Number(np.salePrice ?? 0) * f) : "",
      tierPrices: tiers,
      remise: 0,
      expiryDate: "",
    };
  }

  function pickProduct(i: number, np: ProductOpt) {
    const line = lineForProduct(np);
    setLine(i, {
      productId: line.productId,
      unitId: line.unitId,
      unitPrice: line.unitPrice,
      salePrice: line.salePrice,
      tierPrices: line.tierPrices,
    });
  }

  /// Bulk add: every checked product becomes a line at once
  /// (already-added ones are skipped, never duplicated).
  function confirmBulk() {
    const have = new Set(lines.map((l) => l.productId).filter(Boolean));
    const fresh = [...bulkChecked]
      .map((id) => bulkList.find((p) => p.id === id))
      .filter((p): p is ProductOpt => !!p && !have.has(p.id))
      .map((p) => lineForProduct(p));
    if (!fresh.length) {
      setBulkOpen(false);
      return;
    }
    setLines((ls) => {
      const out = [...ls];
      for (const line of fresh) {
        const idx = out.findIndex((x) => !x.productId);
        if (idx >= 0) out[idx] = { ...out[idx], ...line };
        else out.push(line);
      }
      return out;
    });
    setBulkChecked(new Set());
    setBulkOpen(false);
  }

  /// A product was just created via the + popup: add it to the picker and
  /// fill the first empty line with it (or append a new line).
  async function onProductCreated(id?: string) {
    setShowProduct(false);
    if (!id) return;
    const res = await fetch(`/api/products/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const p = await res.json();
    const opt: ProductOpt = {
      id: p.id,
      name: p.name,
      colisage: p.colisage ?? null,
      barcode: p.barcode ?? null,
      baseUnitId: p.baseUnitId ?? null,
      baseUnit: p.baseUnit ? { id: p.baseUnit.id, name: p.baseUnit.name } : null,
      purchaseUnitId: p.purchaseUnitId ?? null,
      conversions: (p.conversions ?? []).map((c: { unitId: string; factor: unknown; barcode?: string | null; unit: { id: string; name: string } }) => ({
        unitId: c.unitId,
        factor: Number(c.factor),
        barcode: c.barcode ?? null,
        unit: c.unit,
      })),
      costPrice: Number(p.costPrice ?? 0),
      salePrice: Number(p.salePrice ?? 0),
      stockQty: Number(p.stockQty ?? 0),
      images: (p.images ?? []).map((x: { url: string }) => ({ url: x.url })),
      tierPrices: (p.tierPrices ?? []).map((x: { tierId: string; price: unknown }) => ({ tierId: x.tierId, price: Number(x.price) })),
    };
    setExtra((e) => (e.some((x) => x.id === opt.id) ? e : [opt, ...e]));
    setLines((ls) => {
      const line = {
        productId: opt.id,
        unitId: opt.purchaseUnitId ?? opt.baseUnitId ?? "",
        qty: 1,
        unitPrice: "" as number | "",
      };
      const idx = ls.findIndex((x) => !x.productId);
      if (idx >= 0) return ls.map((x, j) => (j === idx ? { ...x, ...line } : x));
      return [...ls, { ...line, freeQty: 0, salePrice: "" as const, tierPrices: {}, remise: 0, expiryDate: "" }];
    });
  }

  async function createSupplier() {
    if (!supName.trim()) {
      setError("missing_fields");
      return;
    }
    setSupBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: supName.trim(), phone: supPhone.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      setSuppliers((s) => [...s, { id: data.id, name: data.name }].sort((a, b) => compareNatural(a.name, b.name, locale)));
      setSupplierId(data.id);
      setSupName("");
      setSupPhone("");
      setShowSupplier(false);
    } finally {
      setSupBusy(false);
    }
  }

  async function submit() {
    setError(null);
    if (!supplierId) {
      setError("supplier_required");
      return;
    }
    const valid = lines.filter((l) => l.productId && l.qty > 0);
    if (!valid.length) {
      setError("lines_required");
      return;
    }
    const paidNum = Number(paid || 0);
    if (!editingId && paidNum > totals.total + 1e-9) {
      setError(labels.overpayment ?? "overpayment");
      return;
    }
    // No prefilled prices: every line needs its real purchase price typed.
    if (valid.some((l) => Number(l.unitPrice || 0) <= 0)) {
      setError("missing_fields");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(editingId ? `/api/purchases/${editingId}` : "/api/purchases", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          locationId: locationId || null,
          date,
          remise: invoiceRemise,
          notes: notes || null,
          invoiceImageUrl: invoiceImage,
          ...(editingId ? {} : { paid: paidNum }),
          lines: valid.map((l) => ({
            productId: l.productId,
            unitId: l.unitId || null,
            qty: l.qty,
            freeQty: 0,
            unitPrice: Number(l.unitPrice || 0),
            salePrice: l.salePrice === "" ? null : Number(l.salePrice),
            tierPrices: Object.entries(l.tierPrices)
              .filter(([, v]) => v !== "")
              .map(([tierId, v]) => ({ tierId, price: Number(v) })),
            remise: l.remise,
            expiryDate: l.expiryDate || null,
          })),
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "save_failed");
        return;
      }
      handleSuccess();
    } finally {
      setBusy(false);
    }
  }

  /// Dual price input (piece + colis): both edit the same per-line-unit
  /// value, so typing either side updates the other instantly. Each field
  /// is labeled with its unit: "prix carton", "prix pièce", …
  const dualPrice = (
    i: number,
    lineVal: number | "",
    setVal: (v: number | "") => void,
    f: number,
    packName: string,
    baseName: string,
    title: string,
    cls: string,
  ) => {
    const ff = f > 0 ? f : 1;
    const piece = lineVal === "" ? "" : Math.round((Number(lineVal) / ff) * 1000) / 1000;
    return (
      <div className="space-y-1">
        <Input
          type="number" min={0} step="any" value={lineVal}
          title={`${title} ${packName}`} placeholder={`${title} ${packName}`}
          onChange={(e) => setVal(e.target.value === "" ? "" : Number(e.target.value))}
          className={cls}
        />
        <Input
          type="number" min={0} step="any" value={piece}
          title={`${title} ${baseName}`} placeholder={`${title} ${baseName}`}
          onChange={(e) => setVal(e.target.value === "" ? "" : Math.round(Number(e.target.value) * ff * 1000) / 1000)}
          className="h-11 text-xs opacity-80 lg:h-8"
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <Card>
        <div className={`grid gap-3 ${showLocation ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.supplier}</label>
            <div className="flex gap-2">
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Button type="button" onClick={() => setShowSupplier(true)} className="shrink-0 px-3" aria-label={labels.newSupplier}>
                <Plus size={17} />
              </Button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.date}</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {showLocation && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.locations}</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {locations.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {lines.map((l, i) => {
        const p = allProducts.find((x) => x.id === l.productId);
        const f = factorOf(p, l.unitId);
        const packsAsc = p ? [...p.conversions].filter((c) => c.factor > 1).sort((a, b) => a.factor - b.factor) : [];
        const levelsAsc = packsAsc.map((c) => ({ name: c.unit.name, factor: Number(c.factor) }));
        return (
          <Card key={i}>
            {i === 0 && (
              <div className="mb-2 hidden gap-2 text-[11px] font-bold uppercase opacity-60 lg:grid" style={{ gridTemplateColumns: lineCols }}>
                <span className="flex items-center gap-1.5">
                  {labels.product}
                  <button
                    type="button"
                    onClick={() => setShowProduct(true)}
                    title={productLabels.newProduct ?? "+"}
                    aria-label={productLabels.newProduct ?? "+"}
                    className="flex h-6 w-6 items-center justify-center rounded-lg bg-(--brand-500)/10 text-sm font-black text-(--brand-600) transition-colors hover:bg-(--brand-500)/20"
                  >
                    <Plus size={14} />
                  </button>
                  {supplierId && supplierProducts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setBulkChecked(new Set()); setBulkOpen(true); }}
                      title={labels.bulkAdd ?? ""}
                      aria-label={labels.bulkAdd ?? ""}
                      className="flex h-6 items-center gap-1 rounded-lg bg-(--brand-500)/10 px-2 text-[11px] font-black text-(--brand-600) transition-colors hover:bg-(--brand-500)/20"
                    >
                      <ListChecks size={14} />
                      {supplierFilter ? supplierProducts.length : allProducts.length}
                    </button>
                  )}
                </span>
                <span>{labels.qty}</span>
                <span>{labels.unit}</span>
                <span>{labels.price} <bdi>(DA)</bdi></span>
                <span>{labels.salePrice}</span>
                {tiers.map((tr) => (
                  <span key={tr.id} className="truncate">{tr.name}</span>
                ))}
                <span className="text-end">{labels.total}</span>
                <span />
              </div>
            )}
            <div className="flex flex-wrap items-start gap-2 lg:grid" style={{ gridTemplateColumns: lineCols }}>
              <div className="min-w-44 flex-1">
                <ProductPicker
                  products={pickerProducts}
                  value={l.productId}
                  onPick={(np) => pickProduct(i, np)}
                  placeholder={labels.product}
                  renderMeta={(x) => <PurchaseRowMeta x={x} />}
                  renderTrailing={(x) => {
                    // Trailing price is per purchase pack (carton), not per
                    // piece: buyers think in colis.
                    const pack = (x.conversions ?? [])
                      .filter((c) => Number(c.factor) > 1)
                      .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
                    const f = pack ? Number(pack.factor) : 1;
                    const price = Math.round(Number(x.costPrice ?? 0) * f * 100) / 100;
                    // No preset cost yet (set by the purchase itself) → no price shown.
                    if (!(price > 0)) return null;
                    return (
                      <span className="shrink-0 text-[13px] font-black tabular-nums">
                        {price}<span className="ms-1 text-[11px] font-bold opacity-60">/ {pack ? pack.unit.name : (x.baseUnit?.name ?? "")}</span>
                      </span>
                    );
                  }}
                />
                {p && <PackInfo product={p} unitId={l.unitId} />}
              </div>
              <div className="w-20 shrink-0">
                <Input type="number" min={0} step="any" value={l.qty} title={labels.qty} placeholder={labels.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className="font-black" />
                {p && l.unitId && l.qty > 0 && (
                  <div className="mt-0.5 truncate text-[11px] font-black text-(--brand-600)">
                    = {breakdownNested(l.qty * (f || 1), baseNameOf(p), levelsAsc[0] ?? null, levelsAsc.length > 1 ? levelsAsc[levelsAsc.length - 1] : null)}
                  </div>
                )}
              </div>
              <select value={l.unitId} title={labels.unit} onChange={(e) => switchUnit(i, e.target.value)} className={`${inputCls} h-11 w-24 shrink-0 px-1 text-xs font-bold`} aria-label={labels.unit}>
                {buyableUnits(p).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <div className="w-28 shrink-0">
                {dualPrice(i, l.unitPrice, (v) => setLine(i, { unitPrice: v }), f,
                  buyableUnits(p).find((u) => u.id === l.unitId)?.name ?? "", baseNameOf(p), labels.price, "font-black")}
              </div>
              <div className="w-28 shrink-0">
                {dualPrice(i, l.salePrice, (v) => setLine(i, { salePrice: v }), f,
                  buyableUnits(p).find((u) => u.id === l.unitId)?.name ?? "", baseNameOf(p), labels.salePrice, "")}
              </div>
              {p && tiers.map((tr) => {
                const typed = l.tierPrices[tr.id];
                return (
                  <div key={tr.id} className="w-24 shrink-0">
                    {dualPrice(i, typed ?? "", (v) => setLine(i, { tierPrices: { ...l.tierPrices, [tr.id]: v } }), f,
                      buyableUnits(p).find((u) => u.id === l.unitId)?.name ?? "", baseNameOf(p), tr.name, "")}
                  </div>
                );
              })}
              <span className="flex h-11 w-24 shrink-0 items-center justify-end text-base font-black tabular-nums">{dzMoney(Math.max(0, l.qty * Number(l.unitPrice || 0) - l.remise))}</span>
              <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="h-11 w-11 shrink-0 px-0">✕</Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {remiseEnabled && (
                <label className="flex items-center gap-1 text-[11px] font-bold uppercase opacity-60">
                  {labels.remise}
                  <Input type="number" min={0} step="any" value={l.remise} onChange={(e) => setLine(i, { remise: Number(e.target.value) })} className="w-24" />
                </label>
              )}
              {expiryEnabled && (
                <label className="flex items-center gap-1 text-[11px] font-bold uppercase opacity-60">
                  {labels.expiry}
                  <Input type="date" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} className="w-36" />
                </label>
              )}
            </div>
          </Card>
        );
      })}
      <Button
        type="button" variant="secondary"
        onClick={() => setLines((ls) => [...ls, blankLine()])}
      >
        {labels.addLine}
      </Button>

      <Card>
        {remiseEnabled && (
          <div className="mb-2">
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.remise}</label>
            <Input type="number" min={0} step="any" value={invoiceRemise} onChange={(e) => setInvoiceRemise(Number(e.target.value))} />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">
            {labels.factoryInvoice} <span className="font-medium normal-case opacity-70">({labels.optional})</span>
          </label>
          {invoiceImage ? (
            <div className="flex items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-sunken) p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={invoiceImage} alt="" className="h-20 w-16 rounded-lg border border-(--border-default) bg-white object-cover" />
              <div className="flex flex-1 flex-wrap gap-2">
                <label className="inline-flex h-11 cursor-pointer items-center rounded-lg bg-(--bg-surface) px-3 text-xs font-bold">
                  <input type="file" accept="image/*" className="hidden" disabled={imgBusy}
                    onChange={(e) => { void pickInvoiceImage(e.target.files?.[0]); e.target.value = ""; }} />
                  {imgBusy ? "…" : labels.changeImage}
                </label>
                <button type="button" onClick={() => setInvoiceImage(null)}
                  className="inline-flex h-11 items-center rounded-lg px-3 text-xs font-bold text-red-500">
                  {labels.removeImage}
                </button>
              </div>
            </div>
          ) : (
            <label className={"flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--border-default) text-sm font-bold opacity-80 hover:opacity-100" + (imgBusy ? " pointer-events-none opacity-50" : "")}>
              <input type="file" accept="image/*" className="hidden" disabled={imgBusy}
                onChange={(e) => { void pickInvoiceImage(e.target.files?.[0]); e.target.value = ""; }} />
              <ImagePlus size={18} />
              {imgBusy ? "…" : labels.attachFactoryInvoice}
            </label>
          )}
          {imgErr && <p className="mt-1 text-xs font-semibold text-red-500">{labels.imageFailed}</p>}
        </div>
        {!editingId && (
          <div className="mt-2">
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.paid}</label>
            <Input
              type="number" min={0} step="any" value={paid}
              max={totals.total}
              onChange={(e) => { setPaidTouched(true); setPaid(e.target.value === "" ? "" : Number(e.target.value)); }}
            />
            <div className="mt-1 text-xs font-bold opacity-60">
              {labels.remaining}: {Math.max(0, totals.total - Number(paid || 0)).toFixed(2)}
            </div>
          </div>
        )}
        <div className="mt-2 text-lg font-black">{labels.total}: {totals.total.toFixed(2)}</div>
      </Card>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleClose} className="flex-1">{labels.cancel}</Button>
        <Button onClick={submit} disabled={busy} className="flex-[2]">{labels.save}</Button>
      </div>

      <Modal open={showProduct} onClose={() => setShowProduct(false)} title={productLabels.newProduct ?? labels.product} icon="+" width="lg">
        <ProductForm
          key={showProduct ? "new" : "closed"}
          initial={{ name: "", minStock: 0, salePrice: 0, costPrice: 0, images: [], conversions: [], tierPrices: [], saleUnitId: null, purchaseUnitId: null, supplierId: supplierId || null }}
          categories={categories}
          suppliers={suppliers}
          units={units ?? []}
          tiers={tiers}
          labels={productLabels}
          locale={locale}
          onSuccess={(id) => void onProductCreated(id)}
          onClose={() => setShowProduct(false)}
        />
      </Modal>

      <Modal open={showSupplier} onClose={() => setShowSupplier(false)} title={labels.newSupplier} icon="+">
        <div className="grid gap-2">
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
          <Input placeholder={labels.supplier} value={supName} onChange={(e) => setSupName(e.target.value)} />
          <Input placeholder={labels.phone} value={supPhone} onChange={(e) => setSupPhone(e.target.value)} inputMode="tel" />
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowSupplier(false)} disabled={supBusy}>
              {labels.cancel}
            </Button>
            <Button onClick={createSupplier} disabled={supBusy}>{supBusy ? "…" : labels.save}</Button>
          </div>
        </div>
      </Modal>

      {/* Bulk add: this supplier's products with checkboxes + select-all.
          Everything checked becomes a purchase line at once. */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={labels.bulkAdd ?? labels.product} icon={<ListChecks size={18} />} width="lg">
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-(--bg-sunken) px-3 py-2.5 text-sm font-black">
            <input
              type="checkbox"
              className="h-5 w-5 accent-(--brand-500)"
              checked={bulkList.length > 0 && bulkList.every((p) => bulkChecked.has(p.id))}
              onChange={(e) => {
                if (e.target.checked) setBulkChecked(new Set(bulkList.map((p) => p.id)));
                else setBulkChecked(new Set());
              }}
            />
            {labels.selectAll ?? ""}
          </label>
          <div className="max-h-[calc(var(--vh)*0.5)] space-y-1.5 overflow-y-auto">
            {bulkList.map((p) => {
              const inLines = lines.some((l) => l.productId === p.id);
              const checked = bulkChecked.has(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-2 ${checked ? "border-(--brand-500) bg-(--brand-500)/5" : "border-(--border-default)"} ${inLines ? "opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-(--brand-500)"
                    checked={checked}
                    disabled={inLines}
                    onChange={(e) => {
                      setBulkChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        return next;
                      });
                    }}
                  />
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].url} alt={p.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-lg">📦</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{p.name}</span>
                    <span className="block truncate text-[11px] opacity-60">
                      {p.colisage ?? ""}{inLines ? ` · ✓` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
            {bulkList.length === 0 && <p className="py-6 text-center text-sm opacity-60">{labels.empty ?? "—"}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setBulkOpen(false)} className="flex-1">{labels.cancel}</Button>
            <Button onClick={() => confirmBulk()} className="flex-[2]">
              {labels.addSelected ?? labels.save} ({bulkChecked.size})
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
