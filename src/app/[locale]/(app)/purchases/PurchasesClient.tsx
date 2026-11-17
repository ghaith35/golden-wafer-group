"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/ui/RowActions";
import { PurchaseForm } from "./PurchaseForm";
import { PurchasePayments } from "./[id]/PurchasePayments";
import type { PurchaseFormData } from "./purchaseRefs";
import { PackInfo, factorOf, normFactor, LinePriceSummary } from "@/components/products/UnitQty";
import { dzMoney, fmtDT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
const num = (v: number) => dzMoney(v);

type Row = {
  id: string;
  number: string;
  date: unknown;
  total: unknown;
  paid: unknown;
  notes: string | null;
  supplier: { name: string };
  _count: { lines: number };
};

type Detail = {
  id: string;
  number: string;
  date: string;
  total: number;
  paid: number;
  remise: number;
  notes: string | null;
  supplier: { id: string; name: string };
  lines: Array<{
    id: string;
    qty: unknown;
    freeQty: unknown;
    unitId: string | null;
    unitPrice: unknown;
    remise: unknown;
    lineTotal: unknown;
    expiryDate: string | null;
    product: {
      name: string;
      reference: string | null;
      colisage?: string | null;
      baseUnitId: string | null;
      baseUnit: { name: string } | null;
      images: Array<{ url: string }>;
      conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { name: string } }>;
    };
  }>;
};

type Payment = { id: string; amount: unknown; date: string; notes: string | null };

type PayStatus = "unpaid" | "partial" | "settled";

const STATUS_COLOR: Record<PayStatus, string> = {
  unpaid: "pill-red",
  partial: "pill-amber",
  settled: "pill-emerald",
};

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

function payStatusOf(total: number, paid: number): PayStatus {
  if (paid <= 0) return "unpaid";
  if (paid >= total - 1e-9) return "settled";
  return "partial";
}

export function PurchasesClient({
  locale,
  rows: initial,
  formData,
  formLabels,
  productLabels,
  labels,
  payLabels,
}: {
  locale: string;
  rows: Row[];
  formData: PurchaseFormData;
  formLabels: Record<string, string>;
  productLabels: Record<string, string>;
  labels: Record<string, string>;
  payLabels: Record<string, string>;
}) {
  const [rows, setRows] = useSyncedState(initial);
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<"" | PayStatus>("");
  /// Default filters: current month + current year (when they hold invoices).
  const [fMonth, setFMonth] = useState(() => {
    const d = new Date();
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    return initial.some((r) => {
      const x = new Date(r.date as string);
      return !Number.isNaN(x.getTime()) && `${x.getFullYear()}-${x.getMonth()}` === key;
    })
      ? key
      : "";
  });
  const [fYear, setFYear] = useState(() => {
    const y = `${new Date().getFullYear()}`;
    return initial.some((r) => {
      const x = new Date(r.date as string);
      return !Number.isNaN(x.getTime()) && `${x.getFullYear()}` === y;
    })
      ? y
      : "";
  });
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; number: string } | null>(null);
  const [editInitial, setEditInitial] = useState<import("./PurchaseForm").PurchaseInitial | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/purchases", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as Row[];
      setRows(data);
      if (selectedId && !data.some((r) => r.id === selectedId)) {
        setSelectedId(data[0]?.id ?? null);
        setDetail(null);
      }
    }
  }

  async function select(id: string) {
    setSelectedId(id);
    setDetail(null);
    setError(null);
    try {
      const [dRes, pRes] = await Promise.all([
        fetch(`/api/purchases/${id}`, { cache: "no-store" }),
        fetch(`/api/purchases/${id}/payments`, { cache: "no-store" }),
      ]);
      if (!dRes.ok) {
        setError("load_failed");
        return;
      }
      const d = await dRes.json();
      setDetail({
        id: d.id,
        number: d.number,
        date: d.date,
        total: Number(d.total),
        paid: Number(d.paid ?? 0),
        remise: Number(d.remise ?? 0),
        notes: d.notes,
        supplier: d.supplier,
        lines: d.lines,
      });
      if (pRes.ok) {
        const p = await pRes.json();
        setPayments(p.payments);
      }
    } catch {
      setError("load_failed");
    }
  }

  async function openEdit(row: Row) {
    setError(null);
    setEditInitial(null);
    setEditing({ id: row.id, number: row.number });
    try {
      const res = await fetch(`/api/purchases/${row.id}`, { cache: "no-store" });
      if (!res.ok) {
        setError("load_failed");
        setEditing(null);
        return;
      }
      const d = await res.json();
      setEditInitial({
        supplierId: d.supplierId,
        date: d.date,
        remise: Number(d.remise ?? 0),
        notes: d.notes ?? null,
        lines: (d.lines ?? []).map((x: { productId: string; unitId: string | null; qty: unknown; freeQty: unknown; unitPrice: unknown; remise: unknown; expiryDate: string | null }) => ({
          productId: x.productId,
          unitId: x.unitId,
          qty: Number(x.qty),
          freeQty: Number(x.freeQty ?? 0),
          unitPrice: Number(x.unitPrice),
          remise: Number(x.remise ?? 0),
          expiryDate: x.expiryDate,
        })),
      });
    } catch {
      setError("load_failed");
      setEditing(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/purchases/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "delete_failed");
      return;
    }
    if (deleting.id === selectedId) {
      setSelectedId(null);
      setDetail(null);
    }
    setDeleting(null);
    await reload();
  }

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const d = new Date(r.date as string);
      if (!Number.isNaN(d.getTime())) set.add(`${d.getFullYear()}-${d.getMonth()}`);
    }
    return [...set].sort().reverse();
  }, [rows]);
  const years = useMemo(() => [...new Set(months.map((m) => m.split("-")[0]))].sort().reverse(), [months]);
  const monthName = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    try {
      return new Date(y, m, 1).toLocaleDateString(locale, { month: "long" });
    } catch {
      return key;
    }
  };

  const filtered = rows.filter((r) => {
    const d = new Date(r.date as string);
    const key = Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${d.getMonth()}`;
    return (
      (!fStatus || payStatusOf(Number(r.total), Number(r.paid ?? 0)) === fStatus) &&
      (!fMonth || key === fMonth) &&
      (!fYear || key.split("-")[0] === fYear) &&
      (!q || r.number.includes(q) || r.supplier.name.includes(q))
    );
  });

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 lg:overflow-hidden">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}

      <div className="flex shrink-0 flex-col gap-2 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:flex-nowrap">
          <Button onClick={() => setCreating(true)} className="h-11 shrink-0">
            <Plus size={16} className="me-1" />
            {labels.neW}
          </Button>
          <div className="min-w-32 flex-1 basis-full sm:basis-auto">
            <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={fYear} onChange={(e) => setFYear(e.target.value)} className={cn(inputCls, "w-24 shrink-0")} aria-label="year">
            <option value="">—</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={cn(inputCls, "w-32 shrink-0")} aria-label="month">
            <option value="">—</option>
            {months.map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-1">
          {(["unpaid", "partial", "settled"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFStatus(fStatus === s ? "" : s)}
              className={cn("flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[12px] font-black lg:flex-none", fStatus === s ? STATUS_COLOR[s] : "bg-(--bg-sunken) opacity-60")}
            >
              {labels[s]}
            </button>
          ))}
          <Link href={`/${locale}/purchases/returns`} className="shrink-0">
            <Button variant="secondary" className="h-[38px] whitespace-nowrap px-3 py-2 text-[12px]">{labels.returns}</Button>
          </Link>
        </div>
      </div>

      <div className="grid min-h-0 items-start gap-4 lg:flex-1 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
        {/* ── Sidebar: list (sticky full height on desktop) ── */}
        <div className="space-y-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
          <div className="max-h-[50vh] flex-1 space-y-1.5 overflow-y-auto lg:max-h-none lg:min-h-0">
            {filtered.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
            {filtered.map((r) => {
              const total = Number(r.total);
              const paid = Number(r.paid ?? 0);
              const st = payStatusOf(total, paid);
              const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
              const active = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  onClick={() => void select(r.id)}
                  className={cn(
                    "w-full rounded-xl border p-2.5 text-start transition-colors",
                    active
                      ? "border-(--brand-500) bg-(--brand-500)/5"
                      : "border-(--border-default) hover:border-(--brand-500)"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold">{labels.number} {r.number}</div>
                      <div className="truncate text-[11px] opacity-60">
                        {r.supplier.name} · {fmtDT(r.date as string, locale)}
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <div className="text-[13px] font-black tabular-nums">{String(r.total)}</div>
                      <span className={cn("rounded-full px-1.5 py-px text-[10px] font-black", STATUS_COLOR[st])}>
                        {labels[st]}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--bg-sunken)">
                    <div
                      className={cn("h-full rounded-full transition-all", st === "settled" ? "bg-emerald-500" : st === "partial" ? "bg-amber-500" : "bg-(--border-default)")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Detail ── */}
        <div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-2">
          {!selected || !detail ? (
            <div className="rounded-2xl border border-dashed border-(--border-default) p-10 text-center text-sm opacity-50">
              {labels.empty}
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
                    <ReceiptText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-black">{labels.number} {detail.number}</div>
                    <div className="truncate text-xs opacity-60">
                      {detail.supplier.name} · {fmtDT(detail.date, locale)}
                      {detail.notes ? ` · ${detail.notes}` : ""}
                    </div>
                  </div>
                  <RowActions
                    onEdit={() => selected && openEdit(selected)}
                    onDelete={() => selected && setDeleting(selected)}
                    labels={{ details: labels.details, edit: labels.edit, delete: labels.delete }}
                  />
                </div>
                {(() => {
                  const pct = detail.total > 0 ? Math.min(100, Math.round((detail.paid / detail.total) * 100)) : 0;
                  const st = payStatusOf(detail.total, detail.paid);
                  return (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-xs font-bold opacity-70">
                        <span>{labels.paid} <b className="tabular-nums text-emerald-600">{num(detail.paid)}</b></span>
                        <span>{labels.remaining} <b className="tabular-nums text-red-500">{num(detail.total - detail.paid)}</b></span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-(--bg-sunken)">
                        <div
                          className={cn("h-full rounded-full transition-all", st === "settled" ? "bg-emerald-500" : st === "partial" ? "bg-amber-500" : "bg-(--border-default)")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
                {detail.lines.map((l) => {
                  const p = l.product;
                  if (!p) {
                    return (
                      <div key={l.id} className="flex items-center justify-between border-b border-(--border-subtle) py-2 text-sm last:border-0">
                        <span className="opacity-60">—</span>
                        <span className="font-black">{String(l.lineTotal)}</span>
                      </div>
                    );
                  }
                  const convs = p.conversions ?? [];
                  const imgs = p.images ?? [];
                  const f = factorOf({ ...p, conversions: convs }, l.unitId ?? "");
                  const uname = !l.unitId || l.unitId === p.baseUnitId
                    ? (p.baseUnit?.name ?? "")
                    : (convs.find((c) => c.unitId === l.unitId)?.unit.name ?? "");
                  const piece = convs.filter((c) => Number(c.factor) < 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
                  const unitPrice = Number(l.unitPrice);
                  const cur = formData.settings.currency === "DZD" ? "DA" : formData.settings.currency;
                  return (
                    <div key={l.id} className="flex gap-3 border-b border-(--border-subtle) py-2.5 text-sm last:border-0">
                      {imgs[0] ? (
                        <button
                          type="button"
                          onClick={() => setZoom({ src: imgs[0].url, name: p.name })}
                          aria-label={p.name}
                          className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-500)"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imgs[0].url} alt={p.name} className="h-14 w-14 rounded-xl object-cover" loading="lazy" />
                        </button>
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-xl opacity-50">📦</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{p.name}</div>
                        <div className="truncate text-xs opacity-60" dir="auto">{p.reference ?? ""}</div>
                        <LinePriceSummary
                          qty={Number(l.qty)}
                          freeQty={Number(l.freeQty) || 0}
                          unit={uname}
                          price={unitPrice}
                          currency={cur}
                          {...(() => {
                            if (f >= 1 && piece) {
                              const n = Math.round(1 / normFactor(Number(piece.factor)));
                              return {
                                pieceUnit: piece.unit.name,
                                piecePrice: unitPrice / n,
                                pieceQty: Math.round(Number(l.qty) * n),
                              };
                            }
                            if (f < 1) {
                              const n = Math.round(1 / f);
                              return {
                                pieceUnit: p.baseUnit?.name ?? "",
                                piecePrice: unitPrice * n,
                                pieceQty: Number(l.qty) * f,
                              };
                            }
                            return {};
                          })()}
                        />
                        <PackInfo product={{ ...p, conversions: convs }} unitId={l.unitId ?? ""} />
                        {(Number(l.remise) > 0 || l.expiryDate) && (
                          <div className="text-xs opacity-60">
                            {Number(l.remise) > 0 ? `− ${String(l.remise)}` : ""}
                            {l.expiryDate ? ` · ⏳ ${new Date(l.expiryDate).toLocaleDateString(locale)}` : ""}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 font-black">{String(l.lineTotal)}</div>
                    </div>
                  );
                })}
                {detail.remise > 0 && (
                  <div className="flex justify-between py-1 text-sm opacity-70">
                    <span>{labels.remise}</span><span>− {detail.remise}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 text-base font-black">
                  <span>{labels.total}</span><span>{detail.total}</span>
                </div>
              </div>
              <PurchasePayments
                invoiceId={detail.id}
                total={detail.total}
                initialPaid={detail.paid}
                initial={payments}
                labels={payLabels}
              />
            </>
          )}
        </div>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={labels.neW}
        subtitle={labels.title}
        icon="+"
        width="2xl"
      >
        <PurchaseForm
          locale={locale}
          suppliers={formData.suppliers}
          products={formData.products}
          units={formData.units}
          tiers={formData.tiers}
          locations={formData.locations}
          categories={formData.categories}
          productLabels={productLabels}
          remiseEnabled={formData.settings.remiseEnabled}
          expiryEnabled={formData.settings.expiryEnabled}
          multiDepot={formData.settings.multiDepotEnabled}
          supplierFilter={formData.settings.supplierFilterEnabled ?? true}
          labels={formLabels}
          onSuccess={() => {
            setCreating(false);
            void (async () => {
              await reload();
            })();
          }}
          onClose={() => setCreating(false)}
        />
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => { setEditing(null); setEditInitial(null); }}
        title={`${labels.edit} · ${editing?.number ?? ""}`}
        subtitle={labels.title}
        icon="✎"
        width="2xl"
      >
        {editing && editInitial && (
          <PurchaseForm
            key={editing.id}
            locale={locale}
            suppliers={formData.suppliers}
            products={formData.products}
            units={formData.units}
            tiers={formData.tiers}
            locations={formData.locations}
            categories={formData.categories}
            productLabels={productLabels}
            remiseEnabled={formData.settings.remiseEnabled}
            expiryEnabled={formData.settings.expiryEnabled}
            multiDepot={formData.settings.multiDepotEnabled}
          supplierFilter={formData.settings.supplierFilterEnabled ?? true}
            labels={formLabels}
            editingId={editing.id}
            initial={editInitial}
            onSuccess={() => {
              const id = editing.id;
              setEditing(null);
              setEditInitial(null);
              void (async () => {
                await reload();
                if (id === selectedId) await select(id);
              })();
            }}
            onClose={() => { setEditing(null); setEditInitial(null); }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={labels.deleteTitle}
        message={deleting ? labels.deleteMessage.replace("{name}", `${labels.number} ${deleting.number}`) : ""}
      />
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.name} caption={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  );
}
