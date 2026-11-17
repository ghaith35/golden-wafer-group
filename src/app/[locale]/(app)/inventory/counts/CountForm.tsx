"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { UnitQty, PackInfo, factorOf, baseNameOf } from "@/components/products/UnitQty";

import { ErrText } from "@/components/ui/ErrText";
const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none";

export function CountForm({
  locale,
  locations,
  products,
  labels,
}: {
  locale: string;
  locations: Array<{ id: string; name: string }>;
  products: Array<{
    id: string;
    name: string;
    colisage?: string | null;
    barcode?: string | null;
    baseUnitId: string | null;
    baseUnit: { id: string; name: string } | null;
    saleUnitId: string | null;
    conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { id: string; name: string } }>;
  }>;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; unitId: string; countedQty: number }>>([{ productId: "", unitId: "", countedQty: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseQtyOf = (l: { productId: string; unitId: string; countedQty: number }) => {
    const p = products.find((x) => x.id === l.productId);
    return l.countedQty * factorOf(p, l.unitId || p?.baseUnitId || "");
  };

  async function submit() {
    setError(null);
    const valid = lines.filter((l) => l.productId);
    if (!locationId || !valid.length) {
      setError("missing_fields");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          notes: notes || null,
          lines: valid.map((l) => ({ productId: l.productId, countedQty: baseQtyOf(l) })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      router.push(`/${locale}/inventory/counts/${data.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-5 md:p-6 lg:max-w-4xl xl:max-w-5xl">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <Card>
        <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.locations}</label>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
          <option value="">—</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <label className="mb-1 mt-2 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Card>
      {lines.map((l, i) => {
        const p = products.find((x) => x.id === l.productId);
        const unitOpts = p
          ? [
              ...(p.baseUnitId ? [{ id: p.baseUnitId, name: p.baseUnit?.name ?? "—" }] : []),
              ...p.conversions.map((c) => ({ id: c.unitId, name: c.unit.name })),
            ]
          : [];
        return (
          <Card key={i}>
            <div className="flex gap-2">
              <div className="flex-1">
                <select
                  value={l.productId}
                  onChange={(e) => {
                    const np = products.find((x) => x.id === e.target.value);
                    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, productId: e.target.value, unitId: np?.saleUnitId ?? np?.baseUnitId ?? "" } : x)));
                  }}
                  className={inputCls}
                >
                  <option value="">{labels.product}</option>
                  {products.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <PackInfo product={p} unitId={l.unitId} />
                <UnitQty qty={l.countedQty} factor={factorOf(p, l.unitId)} baseName={baseNameOf(p)} product={p} />
              </div>
              {unitOpts.length > 1 && (
                <select
                  value={l.unitId}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitId: e.target.value } : x)))}
                  className={`${inputCls} w-28 shrink-0`}
                  aria-label={labels.unit}
                >
                  {unitOpts.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}
              <Input type="number" min={0} step="any" value={l.countedQty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, countedQty: Number(e.target.value) } : x)))} className="w-24" />
              <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
            </div>
          </Card>
        );
      })}
      <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { productId: "", unitId: "", countedQty: 0 }])}>
        {labels.addLine}
      </Button>
      <Button onClick={submit} disabled={busy} className="w-full">{labels.save}</Button>
    </div>
  );
}
