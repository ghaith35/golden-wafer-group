"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { UnitQty, PackInfo, factorOf, baseNameOf } from "@/components/products/UnitQty";

import { ErrText } from "@/components/ui/ErrText";
const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none";
const MOTIVES = ["BREAKAGE", "EXPIRED", "GIFT", "LOSS", "OTHER"] as const;

export function LossForm({
  locations,
  products,
  labels,
}: {
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
  const [locationId, setLocationId] = useState("");
  const [productId, setProductId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [qty, setQty] = useState(1);
  const [motive, setMotive] = useState<string>("BREAKAGE");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const product = products.find((x) => x.id === productId);
  const unitOpts = product
    ? [
        ...(product.baseUnitId ? [{ id: product.baseUnitId, name: product.baseUnit?.name ?? "—" }] : []),
        ...product.conversions.map((c) => ({ id: c.unitId, name: c.unit.name })),
      ]
    : [];

  async function submit() {
    setError(null);
    setDone(false);
    if (!locationId || !productId || qty <= 0) {
      setError("missing_fields");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/losses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          productId,
          baseQty: qty * factorOf(product, unitId || product?.baseUnitId || ""),
          motive,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "save_failed");
        return;
      }
      setDone(true);
      setQty(1);
      setNotes("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">{labels.title}</h1>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      {done && <p className="rounded-lg bg-emerald-500/10 p-2 text-sm text-emerald-600">✓</p>}
      <Card>
        <div className="grid gap-2">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
            <option value="">— {labels.locations}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select
            value={productId}
            onChange={(e) => {
              const np = products.find((x) => x.id === e.target.value);
              setProductId(e.target.value);
              setUnitId(np?.saleUnitId ?? np?.baseUnitId ?? "");
            }}
            className={inputCls}
          >
            <option value="">— {labels.product}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <PackInfo product={product} unitId={unitId} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex gap-2">
                {unitOpts.length > 1 && (
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={`${inputCls} w-28 shrink-0`} aria-label={labels.unit}>
                    {unitOpts.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                )}
                <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
              </div>
              <UnitQty qty={qty} factor={factorOf(product, unitId)} baseName={baseNameOf(product)} product={product} />
            </div>
            <select value={motive} onChange={(e) => setMotive(e.target.value)} className={inputCls}>
              {MOTIVES.map((m) => (
                <option key={m} value={m}>{labels[m]}</option>
              ))}
            </select>
          </div>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={labels.notes} />
          <Button onClick={submit} disabled={busy}>{labels.save}</Button>
        </div>
      </Card>
    </div>
  );
}
