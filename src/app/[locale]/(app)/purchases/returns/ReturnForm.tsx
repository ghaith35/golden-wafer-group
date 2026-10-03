"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { factorOf, baseNameOf, PackInfo } from "@/components/products/UnitQty";
import { breakdownNested } from "@/lib/products/colisage";
import { dz } from "@/lib/format";

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none";

type ProductOpt = {
  id: string;
  name: string;
  stockQty: number;
  colisage?: string | null;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  conversions: Array<{ unitId: string; factor: number; unit: { id: string; name: string } }>;
};

type Line = { productId: string; unitId: string; qty: number; unitPrice: number };

export function SupplierReturnForm({
  locale,
  suppliers,
  products,
  labels,
}: {
  locale: string;
  suppliers: Array<{ id: string; name: string }>;
  products: ProductOpt[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", unitId: "", qty: 1, unitPrice: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /// Buy/sell-with-colisage: when packs exist above base, the loose base
  /// unit is not offered — returns happen in colis levels only.
  const levelsOf = (p: ProductOpt | undefined) => {
    if (!p) return [];
    const list = [{ id: p.baseUnitId ?? "", name: p.baseUnit?.name ?? "—", factor: 1 }];
    for (const c of p.conversions) list.push({ id: c.unitId, name: c.unit.name, factor: c.factor });
    const all = list.filter((u) => u.id).sort((a, b) => a.factor - b.factor);
    return all.some((u) => u.factor > 1) ? all.filter((u) => u.factor > 1) : all;
  };

  function switchUnit(i: number, nextUnitId: string) {
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const p = products.find((x) => x.id === l.productId);
        const oldF = p ? factorOf(p, l.unitId) : 1;
        const nextF = p ? factorOf(p, nextUnitId) : 1;
        const conv =
          oldF > 0 && nextF > 0 && oldF !== nextF && l.unitPrice > 0
            ? Math.round((l.unitPrice / oldF) * nextF * 1000) / 1000
            : l.unitPrice;
        return { ...l, unitId: nextUnitId, unitPrice: conv };
      })
    );
  }

  function pickProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    const levels = levelsOf(p);
    setLines((ls) =>
      ls.map((x, j) => (j === i ? { ...x, productId, unitId: levels[levels.length - 1]?.id ?? p?.baseUnitId ?? "" } : x))
    );
  }

  const computed = useMemo(
    () =>
      lines.map((l) => {
        const p = products.find((x) => x.id === l.productId);
        const f = p ? factorOf(p, l.unitId || p.baseUnitId || "") : 1;
        const baseQty = l.qty * f;
        const priceBase = f > 0 ? l.unitPrice / f : l.unitPrice;
        return { ...l, baseQty, priceBase, lineTotal: l.qty * l.unitPrice, product: p, factor: f };
      }),
    [lines, products]
  );
  const total = useMemo(() => computed.reduce((s, l) => s + (l.productId ? l.lineTotal : 0), 0), [computed]);

  async function submit() {
    setError(null);
    const valid = computed.filter((l) => l.productId && l.qty > 0);
    if (!supplierId || !valid.length) {
      setError("missing_fields");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/supplier-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          notes: notes || null,
          lines: valid.map((l) => ({
            productId: l.productId,
            baseQty: Math.round(l.baseQty * 1000) / 1000,
            unitPrice: Math.round(l.priceBase * 1000) / 1000,
          })),
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "save_failed");
        return;
      }
      router.push(`/${locale}/purchases/returns`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-5 md:p-6">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      <Card>
        <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.supplier}</label>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <label className="mb-1 mt-2 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Card>
      {computed.map((l, i) => {
        const p = l.product;
        const levels = levelsOf(p);
        return (
          <Card key={i}>
            <div className="grid gap-2">
              <select value={l.productId} onChange={(e) => pickProduct(i, e.target.value)} className={inputCls}>
                <option value="">{labels.product}</option>
                {products.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.stockQty}){x.colisage ? ` — ${x.colisage}` : ""}
                  </option>
                ))}
              </select>
              {p && <PackInfo product={p} unitId={l.unitId} />}
              {p && levels.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {levels.map((u, ui, uarr) => {
                    const prev = uarr[ui - 1];
                    const per = prev ? u.factor / prev.factor : u.factor;
                    const child = prev ? prev.name : baseNameOf(p);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => switchUnit(i, u.id)}
                        className={`h-8 rounded-lg border px-2.5 text-xs font-black transition-colors ${
                          l.unitId === u.id || (!l.unitId && u.id === p.baseUnitId)
                            ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                            : "border-(--border-default) opacity-70"
                        }`}
                        title={`1 ${u.name} = ${per.toLocaleString()} ${child}`}
                      >
                        {u.name}
                        <span className="ms-1 opacity-60">×{u.factor.toLocaleString()}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs opacity-60">{labels.qty}</label>
                  <Input
                    type="number" min={0} step="any" value={l.qty}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))}
                  />
                  {p && l.qty > 0 && (
                    <div className="mt-1 text-[11px] font-black text-(--brand-600)">
                      = {(() => {
                        const packs = [...p.conversions]
                          .filter((c) => c.factor > 1)
                          .sort((a, b) => a.factor - b.factor)
                          .map((c) => ({ name: c.unit.name, factor: c.factor }));
                        const l1 = packs[0] ?? null;
                        const l2 = packs.length > 1 ? packs[packs.length - 1] : null;
                        return breakdownNested(l.baseQty, baseNameOf(p), l1, l2);
                      })()}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs opacity-60">
                    {labels.price} {p && <span>(<bdi dir="ltr">DA</bdi>/<bdi>{levels.find((u) => u.id === (l.unitId || p.baseUnitId))?.name ?? ""}</bdi>)</span>}
                  </label>
                  <Input
                    type="number" min={0} step="any" value={l.unitPrice}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: Number(e.target.value) } : x)))}
                  />
                  {p && l.factor !== 1 && (
                    <div className="mt-1 text-[11px] opacity-60">
                      = <bdi dir="ltr">{dz(l.unitPrice / l.factor)} DA</bdi>/<bdi>{baseNameOf(p)}</bdi>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black">{l.lineTotal.toFixed(2)}</span>
                <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
              </div>
            </div>
          </Card>
        );
      })}
      <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { productId: "", unitId: "", qty: 1, unitPrice: 0 }])}>
        {labels.addLine}
      </Button>
      <Card>
        <div className="text-lg font-black">{labels.total}: {total.toFixed(2)}</div>
      </Card>
      <Button onClick={submit} disabled={busy} className="w-full">{labels.save}</Button>
    </div>
  );
}
