"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock, Package, Store } from "lucide-react";
import { dz } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getLastSync, getVanSnapshot, getOutbox, goPage } from "@/lib/sync/client";
import { canSell } from "@/lib/staff-permissions";
import { pendingEffects } from "@/lib/sync/offline-rules";

type Hold = {
  productId: string;
  productName: string;
  held: number;
  vanStock: number;
  free: number;
  orders: Array<{ id: string; number: string; clientName: string; qty: number }>;
  pack: { name: string; factor: number } | null;
  baseUnit: string;
};

/// "2400 قطعة" → "100 كرتون" / "100 كرتون + 5 قطعة" / "5 قطعة".
function breakdown(qty: number, h: Hold): string {
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
  locale,
  day,
  vanId,
  vanName,
  role,
  labels,
}: {
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  role: string;
  labels: Record<string, string>;
}) {
  const depotOnly = !canSell(role);
  const router = useRouter();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [depot, setDepot] = useState<Record<string, number>>({});
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

  useEffect(() => {
    let dead = false;
    fetch(`/api/vans/${vanId}/holds`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead || !d) return;
        applyData(d.holds ?? [], d.depot ?? []);
        setDepotLive(true);
      })
      .catch(() => {
        // Offline: snapshot holds + depot stock from the last sync.
        if (dead) return;
        try {
          setSyncedAt(getLastSync());
        } catch { /* ignore */ }
        getVanSnapshot().then((s) => {
          if (!s) return;
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
            (s.depotStock ?? []).map((b) => ({ productId: b.productId, qty: Number(b.qty) }))
          );
        }).catch(() => {});
      });
    return () => { dead = true; };
  }, [vanId]);

  function applyData(holds: Hold[], depotRows: Array<{ productId: string; qty: number }>) {
    setHolds(holds);
    const m: Record<string, number> = {};
    for (const x of depotRows) m[x.productId] = Number(x.qty);
    setDepot(m);
    setDepotLive(false);
  }

  const list = q ? holds.filter((h) => h.productName.includes(q)) : holds;
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
        {list.map((h) => (
          <div key={h.productId} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken)">
                <Package size={16} />
              </span>
              <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">{h.productName}</div>
              {h.pack && (
                <div className="truncate text-[11px] font-bold text-(--brand-600)">
                  1 {h.pack.name} = <bdi>{dz(h.pack.factor)}</bdi> {h.baseUnit}
                </div>
              )}
            </div>
          </div>
          {depotOnly ? (
            <div className="mt-2 rounded-xl bg-(--bg-sunken) px-3 py-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] font-black uppercase opacity-60">
                <Store size={10} /> {labels.stockDepot ?? labels.stock}{!depotLive && syncAge() ? ` · ${syncAge()}` : ""}
              </div>
              <div className="text-base font-black tabular-nums">{breakdown(depot[h.productId] ?? 0, h)}</div>
            </div>
          ) : (
          <>
          <div className="mt-2 grid grid-cols-3 gap-1 text-center">
            <div className="rounded-lg bg-amber-500/10 px-1 py-1.5">
              <div className="flex items-center justify-center gap-0.5 text-[10px] font-black uppercase opacity-60">
                <Lock size={10} /> held
              </div>
              <div className="text-xs font-black tabular-nums sm:text-sm text-amber-600">{breakdown(h.held, h)}</div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 px-1 py-1.5">
              <div className="text-[10px] font-black uppercase opacity-60">free</div>
              <div className={cn("text-sm font-black tabular-nums", effFree(h) < 0 ? "text-red-500" : "text-emerald-600")}>{breakdown(effFree(h), h)}</div>
            </div>
            <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
              <div className="flex items-center justify-center gap-0.5 text-[10px] font-black uppercase opacity-60">
                <Store size={10} /> depot{!depotLive && syncAge() ? ` · ${syncAge()}` : ""}
              </div>
              <div className="text-xs font-black tabular-nums sm:text-sm">{breakdown(depot[h.productId] ?? 0, h)}</div>
            </div>
          </div>
          {h.orders.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-(--border-subtle) pt-1.5">
              {h.orders.map((o) => (
                <div key={o.id} className="flex justify-between text-[11px]">
                  <span className="truncate opacity-60">{o.number} · {o.clientName}</span>
                  <span className="shrink-0 font-black tabular-nums">{breakdown(o.qty, h)}</span>
                </div>
              ))}
            </div>
          )}
          </>
          )}
          </div>
        ))}
        {list.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
    </div>
  );
}
