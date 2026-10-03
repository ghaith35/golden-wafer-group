"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { packBreakdown } from "@/components/products/UnitQty";
import { cn } from "@/lib/utils";

export type Location = {
  id: string;
  name: string;
  kind: "DEPOT" | "VAN";
  marque: string | null;
  matricule: string | null;
  isActive: boolean;
  user: { fullName: string; username: string } | null;
};

export type Level = { productId: string; locationId: string | null; qty: number };
export type Product = {
  id: string;
  name: string;
  stockQty: unknown;
  minStock: unknown;
  baseUnit?: { name: string } | null;
  conversions?: Array<{ unitId: string; factor: number; unit: { name: string } }>;
};
export type AlertData = {
  lowStock: Array<{ productId: string; name: string; stock: number; min: number }>;
  expired: Array<{ id: string; product: { name: string }; qty: unknown; location: { name: string } | null }>;
  expiring: Array<{ id: string; product: { name: string }; qty: unknown; expiryDate: string; location: { name: string } | null }>;
  inTransit: number;
};

const inputCls = "h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none";

export function InventoryClient({
  locale,
  locations,
  levels,
  products,
  alerts,
  users,
  labels,
  canManage,
}: {
  locale: string;
  locations: Location[];
  levels: Level[];
  products: Product[];
  alerts: AlertData;
  users: Array<{ id: string; fullName: string }>;
  labels: Record<string, string>;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<"stock" | "places" | "alerts">("stock");
  const [locFilter, setLocFilter] = useState("");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState<"DEPOT" | "VAN" | null>(null);
  const [form, setForm] = useState({ name: "", address: "", marque: "", matricule: "", userId: "" });

  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const lname = (id: string | null) => locations.find((l) => l.id === id)?.name ?? "?";
  const rows = levels.filter(
    (l) =>
      (!locFilter || l.locationId === locFilter) &&
      (!q || pname(l.productId).includes(q))
  );

  async function createLocation() {
    if (!form.name.trim()) return;
    const res = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        address: form.address || null,
        kind: showNew,
        marque: form.marque || null,
        matricule: form.matricule || null,
        userId: form.userId || null,
      }),
    });
    if (res.ok) window.location.reload();
  }

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{labels.title}</h1>
        <div className="flex gap-2">
          <Link href={`/${locale}/purchases`}><Button>{labels.addStock}</Button></Link>
          <Link href={`/${locale}/inventory/transfers`}><Button variant="secondary">{labels.transfers}</Button></Link>
          <Link href={`/${locale}/inventory/counts`}><Button variant="secondary">{labels.counts}</Button></Link>
          <Link href={`/${locale}/inventory/losses`}><Button variant="secondary">{labels.losses}</Button></Link>
        </div>
      </div>

      <div className="flex gap-2">
        {(["stock", "places", "alerts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-bold",
              tab === t ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken)"
            )}
          >
            {labels[t === "stock" ? "levels" : t === "places" ? "locations" : "alerts"]}
            {t === "alerts" && (alerts.lowStock.length + alerts.expired.length + alerts.expiring.length > 0) && (
              <span className="ms-1 rounded-full bg-red-500 px-1.5 text-xs text-white">
                {alerts.lowStock.length + alerts.expired.length + alerts.expiring.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <>
          <div className="flex gap-2">
            <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={locFilter} onChange={(e) => setLocFilter(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <Card>
            {rows.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
            {rows.map((l, i) => {
              const p = products.find((x) => x.id === l.productId);
              return (
                <div key={i} className="flex items-center justify-between gap-2 border-b border-(--border-subtle) py-2 text-sm last:border-0">
                  <span className="font-semibold">{pname(l.productId)} <span className="text-xs opacity-50">· {lname(l.locationId)}</span></span>
                  <span className="shrink-0 text-end font-black">
                    {packBreakdown(
                      l.qty,
                      (p?.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: Number(c.factor) })),
                      (id) => p?.conversions?.find((c) => c.unitId === id)?.unit.name ?? "",
                      p?.baseUnit?.name ?? ""
                    )}
                  </span>
                </div>
              );
            })}
          </Card>
        </>
      )}

      {tab === "places" && (
        <>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowNew("DEPOT")}>{labels.newDepot}</Button>
              <Button variant="secondary" onClick={() => setShowNew("VAN")}>{labels.newVan}</Button>
            </div>
          )}
          {showNew && (
            <Card>
              <div className="grid gap-2">
                <Input placeholder={labels.name} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                {showNew === "VAN" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder={labels.marque} value={form.marque} onChange={(e) => setForm((f) => ({ ...f, marque: e.target.value }))} />
                      <Input placeholder={labels.matricule} value={form.matricule} onChange={(e) => setForm((f) => ({ ...f, matricule: e.target.value }))} />
                    </div>
                    <select value={form.userId} onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))} className={inputCls}>
                      <option value="">— {labels.assignedTo}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </select>
                  </>
                )}
                <div className="flex gap-2">
                  <Button onClick={createLocation}>{labels.save}</Button>
                  <Button variant="ghost" onClick={() => setShowNew(null)}>{labels.cancel}</Button>
                </div>
              </div>
            </Card>
          )}
          <div className="grid gap-2">
            {locations.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3" style={l.isActive ? undefined : { opacity: 0.55 }}>
                <div>
                  <div className="text-sm font-bold">
                    {l.kind === "VAN" ? "🚚" : "🏢"} {l.name}
                  </div>
                  <div className="text-xs opacity-60">
                    {l.kind === "VAN" ? `${l.marque ?? ""} ${l.matricule ?? ""}` : labels.depot}
                    {l.user ? ` · ${l.user.fullName}` : ""}
                  </div>
                </div>
                <span className="text-sm font-black">
                  {levels.filter((x) => x.locationId === l.id).reduce((s, x) => s + x.qty, 0)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "alerts" && (
        <div className="space-y-3">
          {alerts.inTransit > 0 && (
            <Card><div className="text-sm">🚚 {labels.inTransit}: <b>{alerts.inTransit}</b></div></Card>
          )}
          {alerts.lowStock.length > 0 && (
            <Card>
              <h2 className="mb-2 text-sm font-bold">⚠️ {labels.lowStock}</h2>
              {alerts.lowStock.map((a) => (
                <div key={a.productId} className="flex justify-between py-1 text-sm">
                  <span>{a.name}</span><span className="font-black text-red-500">{a.stock} / {a.min}</span>
                </div>
              ))}
            </Card>
          )}
          {alerts.expired.length > 0 && (
            <Card>
              <h2 className="mb-2 text-sm font-bold">⛔ {labels.expired}</h2>
              {alerts.expired.map((b) => (
                <div key={b.id} className="flex justify-between py-1 text-sm">
                  <span>{b.product.name} · {b.location?.name}</span><span className="font-black">{String(b.qty)}</span>
                </div>
              ))}
            </Card>
          )}
          {alerts.expiring.length > 0 && (
            <Card>
              <h2 className="mb-2 text-sm font-bold">⏳ {labels.expiring}</h2>
              {alerts.expiring.map((b) => (
                <div key={b.id} className="flex justify-between py-1 text-sm">
                  <span>{b.product.name} · {new Date(b.expiryDate).toLocaleDateString(locale)}</span><span className="font-black">{String(b.qty)}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
