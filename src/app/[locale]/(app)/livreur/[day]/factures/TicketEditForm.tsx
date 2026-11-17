"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { factorOf, priceForUnit } from "@/components/products/UnitQty";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type CatProduct = {
  id: string;
  name: string;
  reference: string | null;
  salePrice: number;
  baseUnitId: string | null;
  baseUnit: { name: string } | null;
  conversions: Array<{ unitId: string; factor: number; unit: { name: string } }>;
  tierPrices: Array<{ tierId: string; price: number }>;
};

type EditLine = { productId: string; unitId: string; qty: number; unitPrice: number | null };

/// Compact ticket-line editor for the livreur factures view: add products,
/// change qty/unit/price, set paid + notes, save rewrites the ticket
/// (server reverses + re-applies stock/debt). Client + van stay locked.
export function TicketEditForm({
  saleId,
  clientId,
  locationId,
  tierId,
  initialLines,
  initialPaid,
  initialNotes,
  labels,
  onSaved,
  onClose,
}: {
  saleId: string;
  clientId: string | null;
  locationId: string;
  tierId: string | null;
  initialLines: Array<{ productId: string; unitId: string | null; qty: number; unitPrice: number | null; remise: number }>;
  initialPaid: number;
  initialNotes: string | null;
  labels: Record<string, string>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<CatProduct[]>([]);
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<EditLine[]>(
    initialLines.map((l) => ({ productId: l.productId, unitId: l.unitId ?? "", qty: l.qty, unitPrice: l.unitPrice }))
  );
  const [paid, setPaid] = useState(String(initialPaid));
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (Array.isArray(rows)) {
          setCatalog(
            (rows as Array<Record<string, never>>).map((p) => {
              const q = p as unknown as {
                id: string; name: string; reference: string | null; salePrice: unknown;
                baseUnitId: string | null; baseUnit: { name: string } | null;
                conversions: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
                tierPrices: Array<{ tierId: string; price: unknown }>;
              };
              return {
                id: q.id,
                name: q.name,
                reference: q.reference,
                salePrice: Number(q.salePrice ?? 0),
                baseUnitId: q.baseUnitId,
                baseUnit: q.baseUnit,
                conversions: (q.conversions ?? []).map((c) => ({
                  unitId: c.unitId,
                  factor: Number(c.factor),
                  unit: c.unit,
                })),
                tierPrices: (q.tierPrices ?? []).map((x) => ({ tierId: x.tierId, price: Number(x.price) })),
              };
            })
          );
        }
      })
      .catch(() => {});
  }, []);

  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  function autoPrice(p: CatProduct, unitId: string): number {
    const base = tierId ? (p.tierPrices.find((x) => x.tierId === tierId)?.price ?? p.salePrice) : p.salePrice;
    return Math.round(base * factorOf(p as never, unitId || p.baseUnitId || "") * 100) / 100;
  }

  const shown = q.trim()
    ? catalog.filter((p) => p.name.includes(q.trim()) || (p.reference ?? "").includes(q.trim())).slice(0, 20)
    : [];

  const total = lines.reduce((s, l) => {
    const p = byId.get(l.productId);
    const price = l.unitPrice ?? (p ? autoPrice(p, l.unitId) : 0);
    return s + l.qty * price;
  }, 0);

  function setLine(i: number, patch: Partial<EditLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function addProduct(pid: string) {
    const p = byId.get(pid);
    if (!p) return;
    setLines((ls) => [...ls, { productId: pid, unitId: "", qty: 1, unitPrice: null }]);
    setQ("");
  }

  async function submit() {
    const valid = lines.filter((l) => l.productId && l.qty > 0);
    if (!valid.length) {
      setError("lines_required");
      return;
    }
    // Online only: there is no offline edit op (the engine cannot reprice a
    // synced ticket from a queued edit) — say so instead of dying silently.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError(labels.offline ?? "offline");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/${saleId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          clientId,
          locationId,
          tierId: tierId ?? null,
          paid: paid === "" ? 0 : Number(paid),
          notes: notes || null,
          lines: valid.map((l) => {
            const p = byId.get(l.productId);
            return {
              productId: l.productId,
              unitId: l.unitId || null,
              qty: l.qty,
              unitPrice: l.unitPrice ?? (p ? autoPrice(p, l.unitId) : 0),
              remise: 0,
            };
          }),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "save_failed");
        return;
      }
      onSaved();
    } catch {
      // Dropped connection mid-edit (not a validation error).
      setError(labels.offline ?? "offline");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <div className="space-y-1.5">
        {lines.map((l, i) => {
          const p = byId.get(l.productId);
          const price = l.unitPrice ?? (p ? autoPrice(p, l.unitId) : 0);
          const units = p ? [{ id: "", name: p.baseUnit?.name ?? "" }, ...p.conversions.map((c) => ({ id: c.unitId, name: c.unit.name }))] : [];
          return (
            <div key={i} className="rounded-xl border border-(--border-default) p-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{p?.name ?? l.productId.slice(-4)}</span>
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  aria-label="remove"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  value={l.unitId}
                  onChange={(e) => setLine(i, { unitId: e.target.value, unitPrice: null })}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-(--border-default) bg-(--bg-surface) px-1 text-xs font-bold outline-none"
                  aria-label={labels.unit ?? "unit"}
                >
                  {units.map((u) => (
                    <option key={u.id || "base"} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <div className="flex shrink-0 items-center gap-1" dir="ltr">
                  <button type="button" aria-label="-" onClick={() => setLine(i, { qty: Math.max(0.5, Math.round((l.qty - 1) * 100) / 100) })} className="flex h-10 w-9 items-center justify-center rounded-lg border border-(--border-default)">
                    <Minus size={14} />
                  </button>
                  <span className="min-w-10 text-center text-sm font-black tabular-nums">{l.qty}</span>
                  <button type="button" aria-label="+" onClick={() => setLine(i, { qty: Math.round((l.qty + 1) * 100) / 100 })} className="flex h-10 w-9 items-center justify-center rounded-lg border border-(--border-default)">
                    <Plus size={14} />
                  </button>
                </div>
                <span className="shrink-0 text-[13px] font-black tabular-nums" dir="ltr">{dzMoney(l.qty * price)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative">
        <Input placeholder={`${labels.product ?? "…"} / ref`} value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length > 0 && (
          <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-xl border border-(--border-default) bg-(--bg-overlay) shadow-xl">
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-(--bg-sunken)"
              >
                <span className="min-w-0 flex-1 truncate font-bold">{p.name}</span>
                <span className="shrink-0 text-xs tabular-nums opacity-60" dir="ltr">{dzMoney(p.salePrice)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between rounded-xl bg-(--brand-500)/10 px-3 py-2 text-sm font-black">
        <span>{labels.total}</span>
        <span dir="ltr">{dzMoney(Math.round(total * 100) / 100)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.paid}</label>
          <Input type="number" min={0} step="any" value={paid} onChange={(e) => setPaid(e.target.value)} dir="ltr" inputMode="decimal" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          <X size={16} />
        </Button>
        <Button onClick={() => void submit()} disabled={busy} className="flex-[2]">
          {busy ? "…" : (labels.save ?? labels.paid)}
        </Button>
      </div>
    </div>
  );
}
