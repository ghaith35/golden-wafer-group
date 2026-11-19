"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { UnitQty, PackInfo, factorOf, baseNameOf, priceForUnit, saleUnits } from "@/components/products/UnitQty";
import { cn } from "@/lib/utils";
import { getVanSnapshot, getOutbox, type VanSnapshot } from "@/lib/sync/client";
import { queueOp } from "@/lib/sync/client";
import { checkOfflineSale } from "@/lib/sync/offline-rules";
import type { OutboxRow } from "@/lib/sync/offline-db";

import { ErrText } from "@/components/ui/ErrText";
export type DocClient = { id: string; name: string; code: string; tierId: string | null; balance: unknown };
export type DocProduct = {
  id: string;
  name: string;
  salePrice: number;
  colisage?: string | null;
  barcode?: string | null;
  baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  saleUnitId: string | null;
  conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { id: string; name: string } }>;
  tierPrices: Array<{ tierId: string; price: number }>;
};
export type DocLine = { productId: string; unitId: string; qty: number; unitPrice: string; remise: number };

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none";

/// Shared order/ticket editor: tier pricing, conversions, remise, paid.
export function SaleDocForm({
  locale,
  mode,
  channel,
  clients,
  products,
  units,
  tiers,
  locations,
  remiseEnabled,
  creditEnabled,
  allowPieces = false,
  defaultTierId,
  lockTier = false,
  presetClientId,
  presetLocationId,
  presetTourneeId,
  labels,
  onCreated,
  editingId,
  initial,
}: {
  locale: string;
  mode: "order" | "ticket";
  channel?: "VAN" | "POS" | "DEPOT";
  clients: DocClient[];
  products: DocProduct[];
  units: Array<{ id: string; name: string }>;
  tiers: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; kind: string }>;
  remiseEnabled: boolean;
  creditEnabled: boolean;
  allowPieces?: boolean;
  defaultTierId?: string;
  /// Livreur flow: price comes from purchases/client category only —
  /// render the effective tier read-only instead of a selector.
  lockTier?: boolean;
  presetClientId?: string;
  presetLocationId?: string;
  presetTourneeId?: string;
  labels: Record<string, string>;
  /// Called with the created doc id. Defaults to opening the detail page
  /// (route usage); the list-page modal closes + navigates itself.
  onCreated?: (id: string) => void;
  /// Edit mode: rewrite a posted TICKET in place (same number/date) instead
  /// of creating. Requires online (server reverses + re-applies postings).
  editingId?: string;
  initial?: {
    clientId: string | null;
    locationId: string | null;
    tierId?: string | null;
    remise?: number;
    paid?: number;
    notes?: string | null;
    lines: Array<{ productId: string; unitId: string | null; qty: number; unitPrice: number | null; remise?: number | null }>;
  } | null;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initial?.clientId ?? presetClientId ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? presetLocationId ?? "");
  const [tierId, setTierId] = useState(initial?.tierId ?? defaultTierId ?? "");
  const [qrScanned, setQrScanned] = useState(false);
  const [docRemise, setDocRemise] = useState(initial?.remise ?? 0);
  const [paid, setPaid] = useState(initial?.paid != null ? String(initial.paid) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [clientQ, setClientQ] = useState("");
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length
      ? initial.lines.map((l) => ({
          productId: l.productId,
          unitId: l.unitId ?? "",
          qty: l.qty,
          unitPrice: l.unitPrice != null ? String(l.unitPrice) : "",
          remise: l.remise ?? 0,
        }))
      : [{ productId: "", unitId: "", qty: 1, unitPrice: "", remise: 0 }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [snap, setSnap] = useState<VanSnapshot | null>(null);
  /// Live "QR strict" from the server — beats the stale synced snapshot copy.
  const [liveQr, setLiveQr] = useState<boolean | null>(null);
  useEffect(() => {
    if (mode !== "ticket") return;
    let live = true;
    fetch("/api/settings/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.qrStrictMode === "boolean") setLiveQr(d.qrStrictMode); })
      .catch(() => {});
    return () => { live = false; };
  }, [mode]);
  const [ops, setOps] = useState<OutboxRow[]>([]);
  /// Synchronous double-tap guard.
  const busyRef = useRef(false);
  /// Main-depot availability (order mode only — commandes are prepared
  /// from the depot, never the van). Online API first, snapshot fallback.
  /// null = unknown (fetch failed); {} = known, missing product means 0.
  const [depot, setDepot] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    let live = true;
    getVanSnapshot().then((s) => {
      if (live) setSnap(s);
    });
    getOutbox().then((o) => {
      if (live) setOps(o);
    });
    return () => {
      live = false;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (mode !== "order") return;
    let live = true;
    fetch("/api/stock/depot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d && typeof d === "object") setDepot(d as Record<string, number>);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mode]);

  /// Offline-first: when the network is down (or server props never arrived),
  /// sell from the on-device snapshot — same prices, units and colisage.
  const snapshotActive = (!online || products.length === 0) && snap !== null;
  const effProducts: DocProduct[] = useMemo(() => {
    if (!snapshotActive || !snap) return products;
    return snap.products.map((p) => ({
      id: p.id,
      name: p.name,
      salePrice: p.salePrice,
      colisage: p.colisage,
      barcode: p.barcode,
      baseUnitId: p.baseUnit?.id ?? null,
      baseUnit: p.baseUnit,
      saleUnitId: null,
      conversions: p.conversions.map((c) => ({
        unitId: c.unitId,
        factor: c.factor,
        barcode: c.barcode,
        unit: { id: c.unitId, name: c.name },
      })),
      tierPrices: p.tierPrices,
    }));
  }, [snapshotActive, snap, products]);
  const effClients: DocClient[] = useMemo(() => {
    if (!snapshotActive || !snap) return clients;
    return snap.clients.map((c) => ({ id: c.id, name: c.name, code: c.code, tierId: c.tierId, balance: c.balance }));
  }, [snapshotActive, snap, clients]);

  const client = effClients.find((c) => c.id === clientId);
  const effTier = tierId || client?.tierId || "";

  function priceFor(p: DocProduct, unitId = ""): number {
    const base = (() => {
      if (effTier) {
        const tp = p.tierPrices.find((x) => x.tierId === effTier);
        if (tp) return tp.price;
      }
      return p.salePrice;
    })();
    return priceForUnit(base, factorOf(p, unitId));
  }

  const unitOptions = (p: DocProduct | undefined) => saleUnits(p, allowPieces);

  const totals = useMemo(() => {
    const linesTotal = lines.reduce((s, l) => {
      const p = effProducts.find((x) => x.id === l.productId);
      const price = l.unitPrice === "" ? (p ? priceFor(p, l.unitId) : 0) : Number(l.unitPrice);
      return s + Math.max(0, l.qty * price - l.remise);
    }, 0);
    return { linesTotal, total: Math.max(0, linesTotal - docRemise) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, docRemise, effTier, effProducts]);

  const paidNum = paid === "" ? (mode === "ticket" ? totals.total : 0) : Number(paid);

  function setLine(i: number, patch: Partial<DocLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  const shownClients = clientQ
    ? effClients.filter((c) => c.name.includes(clientQ) || c.code.includes(clientQ)).slice(0, 30)
    : effClients.slice(0, 30);

  async function submit() {
    if (busyRef.current) return;
    setError(null);
    const valid = lines.filter((l) => l.productId && l.qty > 0);
    if (!valid.length) {
      setError("lines_required");
      return;
    }
    if (mode === "order" && !clientId) {
      setError("client_required");
      return;
    }
    if (mode === "ticket" && !locationId) {
      setError("location_required");
      return;
    }
    // Mirror the server's ticket rules locally (QR/credit/stock/remise) so an
    // offline sale the PC would reject is caught before it's queued.
    if (mode === "ticket") {
      const check = checkOfflineSale({
        snap: snap && liveQr !== null ? { ...snap, settings: { ...snap.settings, qrStrictMode: liveQr } } : snap,
        ops,
        channel: channel ?? "VAN",
        clientId: clientId || null,
        lines: valid.map((l) => ({
          productId: l.productId,
          unitId: l.unitId || null,
          qty: l.qty,
          unitPrice: l.unitPrice === "" ? (effProducts.find((x) => x.id === l.productId) ? priceFor(effProducts.find((x) => x.id === l.productId)!, l.unitId) : 0) : Number(l.unitPrice),
          remise: l.remise,
        })),
        remise: docRemise,
        paid: paidNum,
        qrScanned,
        vanId: locationId,
      });
      if (!check.ok) {
        setError(check.error);
        return;
      }
    }
    busyRef.current = true;
    setBusy(true);
    try {
      // Edit mode: rewrite the posted ticket in place (Admin, online only —
      // the server reverses + re-applies stock/debt, no offline queue).
      if (editingId) {
        const editBody = {
          action: mode === "order" ? "update-order" : "edit",
          clientId: clientId || null,
          locationId,
          tierId: effTier || null,
          remise: docRemise,
          paid: paidNum,
          notes: notes || null,
          lines: valid.map((l) => ({
            productId: l.productId,
            unitId: l.unitId || null,
            qty: l.qty,
            unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
            remise: l.remise,
          })),
        };
        const res = await fetch(`/api/sales/${editingId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editBody),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "save_failed");
          return;
        }
        if (onCreated) onCreated(data.id ?? editingId);
        return;
      }
      const url = mode === "order" ? "/api/sales/orders" : "/api/sales/tickets";
      const body =
        mode === "order"
          ? {
              clientId,
              tierId: effTier || null,
              remise: docRemise,
              paid: paidNum,
              notes: notes || null,
              tourneeId: presetTourneeId ?? null,
              lines: valid.map((l) => ({
                productId: l.productId,
                unitId: l.unitId || null,
                qty: l.qty,
                unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
                remise: l.remise,
              })),
            }
          : {
              clientId: clientId || null,
              locationId,
              tierId: effTier || null,
              channel: channel ?? "VAN",
              qrScanned,
              tourneeId: presetTourneeId ?? null,
              remise: docRemise,
              paid: paidNum,
              notes: notes || null,
              lines: valid.map((l) => ({
                productId: l.productId,
                unitId: l.unitId || null,
                qty: l.qty,
                unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
                remise: l.remise,
              })),
            };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(
        async (netErr: unknown) => {
          // Offline van sale/commande: queue into the on-device outbox, sync
          // when connected (ticket → immediate sale, order → bon de commande
          // for the admin to confirm in Commandes).
          if (mode === "ticket" || mode === "order") {
            try {
              await queueOp(mode, body as Record<string, unknown>);
              setOps(await getOutbox());
            } catch {
              setError("save_failed");
              return null;
            }
            setQueued(true);
            return null;
          }
          throw netErr;
        }
      );
      if (!res) return;
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      if (onCreated) {
        onCreated(data.id);
      } else {
        router.push(`/${locale}/sales/${data.id}`);
        router.refresh();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      {snapshotActive && <p className="rounded-lg bg-amber-500/10 p-2 text-sm font-bold text-amber-600">{labels.offlineMode}</p>}
      {queued && <p className="rounded-lg bg-amber-500/10 p-2 text-sm font-bold text-amber-600">⏳ queued offline — will sync</p>}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.client}</label>
            <Input placeholder={labels.searchClient} value={clientQ} onChange={(e) => setClientQ(e.target.value)} />
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setLines((ls) => ls.map((l) => ({ ...l, unitPrice: "" }))); }} className={inputCls}>
              <option value="">— {mode === "order" ? labels.required : labels.walkin}</option>
              {clientId && !shownClients.some((c) => c.id === clientId) && client && (
                <option value={client.id}>{client.name} · {client.code}</option>
              )}
              {shownClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.code}</option>
              ))}
            </select>
            {client && <div className="mt-1 text-xs opacity-60">{labels.balance}: {String(client.balance)}</div>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.tier}</label>
            {lockTier ? (
              <div className={cn(inputCls, "opacity-70")}>
                {tiers.find((x) => x.id === effTier)?.name ?? "—"}
              </div>
            ) : (
            <select
              value={effTier}
              onChange={(e) => {
                setTierId(e.target.value);
                // Tier drives all line prices: drop manual price overrides so
                // every line reprices from the new tier immediately.
                setLines((ls) => ls.map((l) => ({ ...l, unitPrice: "" })));
              }}
              className={inputCls}
            >
              <option value="">—</option>
              {tiers.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
            )}
          </div>
        </div>
        {mode === "ticket" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.location}</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {locations.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </div>
            {channel === "VAN" && (
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={qrScanned} onChange={(e) => setQrScanned(e.target.checked)} className="h-5 w-5" />
                {labels.qrScanned}
              </label>
            )}
          </div>
        )}
      </Card>

      {lines.map((l, i) => {
        const p = effProducts.find((x) => x.id === l.productId);
        const price = l.unitPrice === "" ? (p ? priceFor(p, l.unitId) : 0) : Number(l.unitPrice);
        return (
          <Card key={i}>
            <div className="grid gap-2">
              <div>
                <select
                  value={l.productId}
                onChange={(e) => {
                  const np = effProducts.find((x) => x.id === e.target.value);
                  const opts = saleUnits(np, allowPieces);
                  const def = np?.saleUnitId && opts.some((u) => u.id === np.saleUnitId)
                    ? np.saleUnitId
                    : (opts[0]?.id ?? np?.baseUnitId ?? "");
                  setLine(i, { productId: e.target.value, unitId: def });
                }}
                  className={inputCls}
                >
                  <option value="">{labels.product}</option>
                  {effProducts.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <PackInfo product={p} unitId={l.unitId} />
                {mode === "order" && l.productId && (
                  <div className="mt-0.5 truncate text-[11px] font-bold text-(--brand-600)">
                    🏭 {labels.depotStock}:{" "}
                    <span className="tabular-nums" dir="ltr">
                      {(() => {
                        const q = depot ? (depot[l.productId] ?? 0)
                          : Number(snap?.depotStock?.find((b) => b.productId === l.productId)?.qty ?? NaN);
                        if (!Number.isFinite(q)) return "—";
                        const pack = p?.conversions
                          ?.filter((c) => Number(c.factor) > 1)
                          .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
                        if (!pack) return `${q} ${p?.baseUnit?.name ?? ""}`;
                        const f = Number(pack.factor);
                        const whole = Math.floor(q / f);
                        const rest = Math.round((q - whole * f) * 1000) / 1000;
                        return `${whole} ${pack.unit.name}${rest > 0 ? ` + ${rest} ${p?.baseUnit?.name ?? ""}` : ""}`;
                      })()}
                    </span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="text-xs opacity-60">{labels.unit}</label>
                  <select value={l.unitId} onChange={(e) => setLine(i, { unitId: e.target.value })} className={inputCls}>
                    {unitOptions(p).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs opacity-60">{labels.qty}</label>
                  <Input type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                  <UnitQty qty={l.qty} factor={factorOf(p, l.unitId)} baseName={baseNameOf(p)} product={p} />
                </div>
                <div>
                  <label className="text-xs opacity-60">{labels.price}</label>
                  <Input
                    type="number" min={0} step="any" value={l.unitPrice} placeholder={String(price)}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs opacity-60">{labels.lineTotal}</label>
                  <div className="flex h-10 items-center text-sm font-black">{Math.max(0, l.qty * price - l.remise).toFixed(2)}</div>
                </div>
              </div>
              {remiseEnabled && (
                <div className="w-32">
                  <label className="text-xs opacity-60">{labels.remise}</label>
                  <Input type="number" min={0} step="any" value={l.remise} onChange={(e) => setLine(i, { remise: Number(e.target.value) })} />
                </div>
              )}
              <div className="flex justify-end">
                <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
              </div>
            </div>
          </Card>
        );
      })}
      <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { productId: "", unitId: "", qty: 1, unitPrice: "", remise: 0 }])}>
        {labels.addLine}
      </Button>

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          {remiseEnabled && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.remise}</label>
              <Input type="number" min={0} step="any" value={docRemise} onChange={(e) => setDocRemise(Number(e.target.value))} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.paid} {creditEnabled ? "" : `(${labels.cashOnly})`}</label>
            <Input type="number" min={0} step="any" value={paid} placeholder={String(totals.total.toFixed(2))} onChange={(e) => setPaid(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.total}</label>
            <div className="flex h-10 items-center text-lg font-black">{totals.total.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Card>

      <Button onClick={submit} disabled={busy} className="w-full">{labels.save}</Button>
    </div>
  );
}
