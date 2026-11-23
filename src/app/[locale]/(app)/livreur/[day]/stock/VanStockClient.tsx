"use client";

import { ClientName } from "@/components/clients/ClientName";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock, Store } from "lucide-react";
import { dz } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getLastSync, getVanSnapshot, getOutbox, goPage } from "@/lib/sync/client";
import { canSell } from "@/lib/staff-permissions";
import { pendingEffects } from "@/lib/sync/offline-rules";
import { useDataVersion } from "@/lib/data-sync";
import { ProductThumb, useProductImages } from "@/components/products/ProductThumb";

type Hold = {
  productId: string;
  productName: string;
  held: number;
  vanStock: number;
  free: number;
  orders: Array<{ id: string; number: string; clientName: string; gpsLat?: number | null; gpsLng?: number | null; qty: number }>;
  pack: { name: string; factor: number } | null;
  baseUnit: string;
};

/// "2400 قطعة" → "100 كرتون" / "100 كرتون + 5 قطعة" / "5 قطعة".
function breakdown(qty: number, h: { pack: { name: string; factor: number } | null; baseUnit: string }): string {
  const q = Math.round(qty * 1000) / 1000;
  if (!h.pack || q < 0) return `${dz(q)} ${h.baseUnit}`;
  const f = h.pack.factor;
  const whole = Math.floor(q / f + 1e-9);
  const rest = Math.round((q - whole * f) * 1000) / 1000;
  if (whole > 0 && rest > 0) return `${dz(whole)} ${h.pack.name} + ${dz(rest)} ${h.baseUnit}`;
  if (whole > 0) return `${dz(whole)} ${h.pack.name}`;
  return `${dz(q)} ${h.baseUnit}`;
}

/// Livreur stock: per product — held for commandes vs free to sell + depot.
/// Vendeur (mandob) sees DEPOT stock only: held/free/order holds are hidden
/// (van internals), the title reads depot stock.
export function VanStockClient({
  images,
  locale,
  day,
  vanId,
  vanName,
  role,
  labels,
}: {
  images?: Record<string, string[]>;
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  role: string;
  labels: Record<string, string>;
}) {
  const depotOnly = !canSell(role);
  const imgs = useProductImages(images);
  const router = useRouter();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [depot, setDepot] = useState<Record<string, number>>({});
  /// Depot-only catalogue (Vendeur): built from DEPOT rows, never from van
  /// holds — a vendeur van holds nothing, so the holds list is empty and
  /// iterating it showed a blank page over a full depot.
  const [depotList, setDepotList] = useState<Array<{
    productId: string; name: string; qty: number;
    pack: { name: string; factor: number } | null; baseUnit: string;
  }>>([]);
  const [q, setQ] = useState("");
  /// Depot snapshot age (shown when numbers come from the last sync).
  const [depotLive, setDepotLive] = useState(true);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  /// Sold-but-not-synced units: subtracted once so this page agrees with
  /// the sale popup (which caps by the same effective stock).
  const [pending, setPending] = useState<Record<string, number>>({});
  useEffect(() => {
    getOutbox()
      .then(async (ops) => {
        const snap = await getVanSnapshot().catch(() => null);
        setPending(pendingEffects(snap, ops, vanId).stock);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vanId]);

  function syncAge(): string {
    if (!syncedAt) return "";
    try {
      const d = new Date(syncedAt);
      const now = new Date();
      const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      return d.toDateString() === now.toDateString()
        ? time
        : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
    } catch {
      return "";
    }
  }

  const dataV = useDataVersion();
  useEffect(() => {
    let dead = false;
    fetch(`/api/vans/${vanId}/holds`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead || !d) return;
        applyData(d.holds ?? [], d.depot ?? [], d.depotProducts ?? []);
        setDepotLive(true);
      })
      .catch(() => {
        // Offline: snapshot holds + depot stock from the last sync. The
        // depot catalogue joins depotStock with the snapshot products —
        // same union rule as online, so the page matches either way.
        if (dead) return;
        try {
          setSyncedAt(getLastSync());
        } catch { /* ignore */ }
        getVanSnapshot().then((s) => {
          if (!s) return;
          const prods = new Map((s.products ?? []).map((p) => [p.id, p]));
          const packOf = (p: { conversions?: Array<{ name: string; factor: number }>; baseUnit?: { name: string } | null }) => {
            const pack = (p.conversions ?? [])
              .filter((c) => Number(c.factor) > 1)
              .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
            return {
              pack: pack ? { name: pack.name, factor: Number(pack.factor) } : null,
              baseUnit: p.baseUnit?.name ?? "",
            };
          };
          applyData(
            (s.holds ?? []).map((h) => ({
              productId: h.productId,
              productName: h.productName ?? h.productId.slice(-4),
              held: Number(h.held),
              vanStock: Number(h.vanStock),
              free: Number(h.free),
              orders: h.orders ?? [],
              pack: h.pack ?? null,
              baseUnit: h.baseUnit ?? "",
            })),
            (s.depotStock ?? []).map((b) => ({ productId: b.productId, qty: Number(b.qty) })),
            (s.depotStock ?? []).map((b) => {
              const p = prods.get(b.productId);
              return {
                productId: b.productId,
                name: p?.name ?? b.productId.slice(-4),
                ...packOf(p ?? {}),
              };
            })
          );
        }).catch(() => {});
      });
    return () => { dead = true; };
  }, [vanId, dataV]);

  function applyData(
    holds: Hold[],
    depotRows: Array<{ productId: string; qty: number }>,
    depotCatalog: Array<{ productId: string; name: string; pack: { name: string; factor: number } | null; baseUnit: string }>,
  ) {
    setHolds(holds);
    const m: Record<string, number> = {};
    for (const x of depotRows) m[x.productId] = Number(x.qty);
    setDepot(m);
    setDepotLive(false);
    // Depot catalogue = every depot-stocked product: the server catalogue
    // first, then van-hold rows covering depot products the catalogue
    // missed — quantities come from the depot map in both cases.
    const byId = new Map(depotCatalog.map((c) => [c.productId, c]));
    for (const h of holds) {
      if (m[h.productId] == null || byId.has(h.productId)) continue;
      byId.set(h.productId, { productId: h.productId, name: h.productName, pack: h.pack, baseUnit: h.baseUnit });
    }
    setDepotList(
      [...byId.values()]
        .map((c) => ({ ...c, qty: m[c.productId] ?? 0 }))
        .filter((c) => c.qty > 1e-9)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    );
  }

  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const list = (q ? holds.filter((h) => h.productName.includes(q)) : [...holds]).sort((a, b) => byName(a.productName, b.productName));
  const depotView = q
    ? depotList.filter((h) => h.name.includes(q))
    : depotList;
  /// Effective free stock = holds free − queued sales (same math as vente).
  const effFree = (h: Hold) => h.free + (pending[h.productId] ?? 0);

  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{depotOnly ? (labels.stockDepot ?? labels.stock) : labels.stock}</h1>
          <p className="truncate text-xs opacity-60">{vanName}</p>
        </div>
      </div>
      <input
        placeholder="…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)"
      />
      <div className="space-y-1.5">
        {depotOnly ? depotView.map((h) => (
          <div key={h.productId} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
            <div className="flex items-center gap-2">
              <ProductThumb name={h.name} images={imgs.get(h.productId)} />
              <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">{h.name}</div>
              {h.pack && (
                <div className="truncate text-[11px] font-bold text-(--brand-600)">
                  1 {h.pack.name} = <bdi>{dz(h.pack.factor)}</bdi> {h.baseUnit}
                </div>
              )}
            </div>
          </div>
            <div className="mt-2 rounded-xl bg-(--bg-sunken) px-3 py-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase opacity-60">
                <Store size={10} /> {labels.stockDepot ?? labels.stock}{!depotLive && syncAge() ? ` · ${syncAge()}` : ""}
              </div>
              <div className="text-base font-black tabular-nums">{breakdown(h.qty, h)}</div>
            </div>
          </div>
        )) : list.map((h) => (
          <div key={h.productId} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
            <div className="flex items-center gap-2">
              <ProductThumb name={h.productName} images={imgs.get(h.productId)} />
              <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">{h.productName}</div>
              {h.pack && (
                <div className="truncate text-[11px] font-bold text-(--brand-600)">
                  1 {h.pack.name} = <bdi>{dz(h.pack.factor)}</bdi> {h.baseUnit}
                </div>
              )}
            </div>
          </div>
          <>
          <div className="mt-2 grid grid-cols-3 gap-1 text-center">
            <div className="rounded-lg bg-amber-500/10 px-1 py-1.5">
              <div className="flex items-center justify-center gap-0.5 text-[10px] font-black uppercase opacity-60">
                <Lock size={10} /> {labels.held ?? "held"}
              </div>
              <div className="text-xs font-black tabular-nums sm:text-sm text-amber-600">{breakdown(h.held, h)}</div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 px-1 py-1.5">
              <div className="text-[10px] font-black uppercase opacity-60">{labels.free ?? "free"}</div>
              <div className={cn("text-sm font-black tabular-nums", effFree(h) < 0 ? "text-red-500" : "text-emerald-600")}>{breakdown(effFree(h), h)}</div>
            </div>
            <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
              <div className="flex items-center justify-center gap-0.5 text-[10px] font-black uppercase opacity-60">
                <Store size={10} /> {labels.depotLbl ?? "depot"}{!depotLive && syncAge() ? ` · ${syncAge()}` : ""}
              </div>
              <div className="text-xs font-black tabular-nums sm:text-sm">{breakdown(depot[h.productId] ?? 0, h)}</div>
            </div>
          </div>
          {h.orders.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-(--border-subtle) pt-1.5">
              {h.orders.map((o) => (
                <div key={o.id} className="flex justify-between text-[11px]">
                  <span className="flex min-w-0 items-center gap-1 opacity-80"><span className="shrink-0 opacity-70">{o.number} ·</span><ClientName name={o.clientName} lat={o.gpsLat} lng={o.gpsLng} /></span>
                  <span className="shrink-0 font-black tabular-nums">{breakdown(o.qty, h)}</span>
                </div>
              ))}
            </div>
          )}
          </>
          </div>
        ))}
        {(depotOnly ? depotView : list).length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
    </div>
  );
}
