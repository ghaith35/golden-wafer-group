"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { ProductGallery } from "@/components/products/ProductGallery";
import { cn } from "@/lib/utils";
import { dzMoney } from "@/lib/format";

import { ErrText } from "@/components/ui/ErrText";
type P = {
  id: string;
  name: string;
  reference: string | null;
  price: number;
  images: string[];
  units: Array<{ id: string; name: string; factor: number }>;
  inStock: boolean;
};

type Order = {
  id: string;
  number: string;
  status: string;
  total: unknown;
  date: string;
  lines: Array<{ qty: unknown; lineTotal: unknown; product: { name: string } }>;
};

export function PortalShop({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const router = useRouter();
  const [client, setClient] = useState("");
  const [products, setProducts] = useState<P[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Record<string, { qty: number; unitId: string }>>({});
  const [tab, setTab] = useState<"shop" | "orders">("shop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portal/catalog")
      .then((r) => {
        if (r.status === 401) {
          router.push(`/${locale}/portal/login`);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        setClient(d.client.name as string);
        setProducts(d.products as P[]);
      })
      .catch(() => {});
    fetch("/api/portal/orders")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setOrders(d as Order[]))
      .catch(() => {});
  }, [locale, router]);

  const shown = q ? products.filter((p) => p.name.includes(q)) : products;
  const cartCount = Object.values(cart).reduce((s, c) => s + c.qty, 0);
  const cartTotal = Object.entries(cart).reduce((s, [id, c]) => {
    const p = products.find((x) => x.id === id);
    if (!p) return s;
    return s + c.qty * p.price;
  }, 0);

  function setQty(id: string, qty: number, unitId?: string) {
    setCart((c) => {
      if (qty <= 0) {
        const n = { ...c };
        delete n[id];
        return n;
      }
      return { ...c, [id]: { qty, unitId: unitId ?? c[id]?.unitId ?? "" } };
    });
  }

  async function submit() {
    setError(null);
    const lines = Object.entries(cart)
      .filter(([, c]) => c.qty > 0)
      .map(([productId, c]) => ({ productId, unitId: c.unitId || null, qty: c.qty }));
    if (!lines.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/portal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "failed");
        return;
      }
      setCart({});
      setOrders(await fetch("/api/portal/orders").then((r) => r.json()));
      setTab("orders");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push(`/${locale}/portal/login`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{client || "…"}</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab("shop")} className={cn("rounded-lg px-3 py-1.5 text-sm font-bold", tab === "shop" ? "bg-(--brand-500) text-(--brand-contrast)" : "bg-(--bg-sunken)")}>
            {labels.shop} {cartCount > 0 ? `(${cartCount})` : ""}
          </button>
          <button onClick={() => setTab("orders")} className={cn("rounded-lg px-3 py-1.5 text-sm font-bold", tab === "orders" ? "bg-(--brand-500) text-(--brand-contrast)" : "bg-(--bg-sunken)")}>
            {labels.orders}
          </button>
          <button onClick={logout} className="rounded-lg bg-(--bg-sunken) px-3 py-1.5 text-sm">⏻</button>
        </div>
      </div>

      {tab === "shop" && (
        <>
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {shown.map((p) => {
              const c = cart[p.id];
              const selUnit = p.units.find((u) => u.id === (c?.unitId ?? p.units[0]?.id)) ?? p.units[0];
              const selPrice = selUnit ? p.price * selUnit.factor : p.price;
              const baseUnit = p.units.reduce((a, b) => (a.factor < b.factor ? a : b), p.units[0]);
              return (
                <Card key={p.id}>
                  <ProductGallery images={p.images} alt={p.name} className="mb-2 aspect-video w-full" />
                  <div className="text-sm font-bold">{p.name}</div>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <div className="rounded-lg bg-(--brand-500)/10 px-2 py-1">
                      <div className="truncate text-[9px] font-black uppercase opacity-60">{selUnit?.name ?? ""}</div>
                      <div className="truncate text-sm font-black tabular-nums text-(--brand-600)" dir="ltr">{dzMoney(selPrice)}</div>
                    </div>
                    <div className="rounded-lg bg-(--bg-sunken) px-2 py-1">
                      <div className="truncate text-[9px] font-black uppercase opacity-60">{baseUnit?.name ?? ""}</div>
                      <div className="truncate text-sm font-black tabular-nums" dir="ltr">{dzMoney(p.price)}</div>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className={`text-xs font-bold ${p.inStock ? "text-emerald-600" : "text-red-500"}`}>
                      {p.inStock ? labels.inStock : labels.outStock}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {p.units.length > 0 && (
                      <select
                        value={c?.unitId ?? p.units[0].id}
                        onChange={(e) => setQty(p.id, c?.qty ?? 0, e.target.value)}
                        className="h-9 rounded-lg border border-(--border-default) bg-(--bg-surface) px-1 text-xs"
                      >
                        {p.units.map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex flex-1 items-center justify-end gap-2">
                      <button onClick={() => setQty(p.id, (c?.qty ?? 0) - 1, c?.unitId)} className="h-9 w-9 rounded-lg bg-(--bg-sunken) font-black">−</button>
                      <span className="w-8 text-center font-black">{c?.qty ?? 0}</span>
                      <button onClick={() => setQty(p.id, (c?.qty ?? 0) + 1, c?.unitId ?? p.units[0]?.id)} className="h-9 w-9 rounded-lg bg-(--brand-500) font-black text-(--brand-contrast)">+</button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          {cartCount > 0 && (
            <div className="sticky bottom-4">
              <Button onClick={submit} disabled={busy} className="w-full shadow-lg">
                {labels.order} · {cartCount} · {dzMoney(cartTotal)}
              </Button>
            </div>
          )}
        </>
      )}

      {tab === "orders" && (
        <div className="space-y-2">
          {orders.map((o) => (
            <Card key={o.id}>
              <div className="flex justify-between text-sm">
                <span className="font-bold"><bdi dir="ltr">{o.number}</bdi> · {o.status}</span>
                <span className="font-black">{dzMoney(Number(o.total))}</span>
              </div>
              <div className="mt-1 text-xs opacity-60">
                <bdi>{new Date(o.date).toLocaleDateString(locale)}</bdi> · {o.lines.map((l, i) => (<span key={i}><bdi dir="auto">{l.product.name}</bdi> <bdi dir="ltr">×{String(l.qty)}</bdi>{i < o.lines.length - 1 ? ", " : ""}</span>))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
