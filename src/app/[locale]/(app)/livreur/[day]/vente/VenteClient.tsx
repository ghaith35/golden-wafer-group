"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownUp, ArrowLeft, Check, Minus, Plus, Printer, QrCode, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { CameraBox } from "@/components/scan/CameraBox";
import { TicketView, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { factorOf, normFactor, priceForUnit, saleUnits } from "@/components/products/UnitQty";
import { beepAdd, beepConfirm } from "@/lib/beep";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getVanSnapshot, getOutbox, queueOp, type VanSnapshot } from "@/lib/sync/client";
import { checkOfflineSale, pendingEffects } from "@/lib/sync/offline-rules";
import type { OutboxRow } from "@/lib/sync/offline-db";

type Client = { id: string; name: string; code: string; phone: string | null; tierId: string | null; balance: unknown };
type Prod = {
  id: string; name: string; reference: string | null;
  salePrice: unknown; baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  images: Array<{ url: string }>;
  tierPrices: Array<{ tierId: string; price: unknown }>;
  conversions: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
  category: { id: string; name: string } | null;
};
type Line = { productId: string; unitId: string | null; qty: number; unitPrice: number };

function priceFor(p: Prod, tierId: string | null): number {
  const tp = tierId ? p.tierPrices.find((x) => x.tierId === tierId) : null;
  return tp ? Number(tp.price) : Number(p.salePrice ?? 0);
}

/// Step 4 — Vente as a PAGE: scan popup → products → qty sheet → facture → print.
export function VenteClient({
  locale,
  day,
  vanId,
  vanName,
  tourneeId,
  initialClient,
  products,
  categories,
  vanStock,
  allowPieces,
  labels,
  ticketLabels,
  ticketLang,
}: {
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  tourneeId: string | null;
  initialClient: Client | null;
  products: Prod[];
  categories: Array<{ id: string; name: string }>;
  vanStock: Record<string, number>;
  allowPieces: boolean;
  labels: Record<string, string>;
  ticketLabels: TicketLabels;
  ticketLang: "ar" | "fr";
}) {
  const router = useRouter();
  const [scanOpen, setScanOpen] = useState(!initialClient);
  /// Strict QR (settings toggle ON): only a real scan counts, and the server
  /// rejects the ticket otherwise.
  const [qrStrict, setQrStrict] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [client, setClient] = useState<Client | null>(initialClient);
  const [cat, setCat] = useState("");
  const [pq, setPq] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [showFacture, setShowFacture] = useState(false);
  const [qtyFor, setQtyFor] = useState<Prod | null>(null);
  const [qtyPacks, setQtyPacks] = useState(1);
  const [qtyUnits, setQtyUnits] = useState(0);
  /// Edit mode: tapping a product already in the facture edits its single
  /// line — one line per product, never duplicates.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [paid, setPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [doneQueued, setDoneQueued] = useState(false);
  /// Print preview: created ticket (server response or local snapshot when
  /// offline) + company header/width for the TicketView.
  const [doneTicket, setDoneTicket] = useState<TicketVM | null>(null);
  const [ticketCo, setTicketCo] = useState<{ company: { name: string; phone?: string | null; address?: string | null; rc?: string | null; nif?: string | null; logoUrl?: string | null }; width: "58" | "80"; currency: string } | null>(null);
  const [ticketQr, setTicketQr] = useState<string | null>(null);
  const [isNative, setIsNative] = useState(false);
  const [gallery, setGallery] = useState<Prod | null>(null);
  const [gIdx, setGIdx] = useState(0);
  const [freshStock, setFreshStock] = useState<number | null>(null);
  /// Free-to-sell per product (van total − held for commandes). Sales cap
  /// here: locked commande stock is never sellable.
  const [freeMap, setFreeMap] = useState<Record<string, number> | null>(null);
  const [heldMap, setHeldMap] = useState<Record<string, number>>({});
  /// Offline snapshot (first sync seeds the whole catalog): used whenever a
  /// fetch fails so the van keeps selling with zero connection.
  const [snap, setSnap] = useState<VanSnapshot | null>(null);
  /// Queued (unsynced) ops — their effects are subtracted from local stock so
  /// an offline sale can't promise the same units twice.
  const [ops, setOps] = useState<OutboxRow[]>([]);

  useEffect(() => {
    getVanSnapshot().then(setSnap).catch(() => {});
    getOutbox().then(setOps).catch(() => {});
  }, []);
  const pressTimer = useRef(0);
  const touchX = useRef<number | null>(null);
  /// Synchronous double-tap guard (state updates are async).
  const submittingRef = useRef(false);

  useEffect(() => {
    let dead = false;
    import("@capacitor/core").then(({ Capacitor }) => {
      if (!dead) setIsNative(Capacitor.isNativePlatform());
    }).catch(() => {});
    fetch("/api/settings/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead) return;
        if (d?.qrStrictMode) {
          setQrStrict(true);
          setScanned(false);
          setScanOpen(true);
        }
        setTicketCo({
          company: d?.company ?? { name: "" },
          width: d?.ticketWidth === "58" ? "58" : "80",
          currency: d?.currency ?? "DZD",
        });
      })
      .catch(() => {
        // Offline: fall back to the synced snapshot's flag.
        if (!dead) getVanSnapshot().then((s) => {
          if (s?.settings.qrStrictMode) {
            setQrStrict(true);
            setScanned(false);
            setScanOpen(true);
          }
        }).catch(() => {});
      });
    // Free/held split for this van (locked commande stock is unsellable).
    fetch(`/api/vans/${vanId}/holds`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead || !d || !Array.isArray(d.holds)) return;
        applyHolds(d.holds);
      })
      .catch(() => {
        // Offline: snapshot holds from the last sync.
        if (!dead) getVanSnapshot().then((s) => {
          if (s?.holds) applyHolds(s.holds);
        }).catch(() => {});
      });
    return () => { dead = true; };
  }, [vanId]);

  function applyHolds(list: Array<{ productId: string; free: number; held: number }>) {
    const free: Record<string, number> = {};
    const held: Record<string, number> = {};
    for (const h of list) {
      free[h.productId] = Number(h.free);
      if (Number(h.held) > 0) held[h.productId] = Number(h.held);
    }
    setFreeMap(free);
    setHeldMap(held);
  }

  /// Offline fallbacks from the synced snapshot (first sync seeds it all).
  const snapProds: Prod[] | null = snap ? (() => {
    const catName = new Map((snap.categories ?? []).map((c) => [c.id, c.name]));
    return snap.products.map((p) => ({
      id: p.id,
      name: p.name,
      reference: p.reference,
      salePrice: p.salePrice,
      baseUnitId: p.baseUnit?.id ?? null,
      baseUnit: p.baseUnit,
      images: p.images.map((url) => ({ url })),
      tierPrices: p.tierPrices.map((x) => ({ tierId: x.tierId, price: x.price })),
      conversions: p.conversions.map((c) => ({ unitId: c.unitId, factor: c.factor, unit: { name: c.name } })),
      category: p.categoryId ? { id: p.categoryId, name: catName.get(p.categoryId) ?? "" } : null,
    }));
  })() : null;
  const effProducts = products.length > 0 ? products : (snapProds ?? []);
  const effCategories = categories.length > 0 ? categories : (snap?.categories ?? []);
  const snapStock = (() => {
    if (!snap) return null;
    const m: Record<string, number> = {};
    for (const b of snap.stock ?? []) m[b.productId] = Number(b.qty);
    return m;
  })();
  /// Pending (unsynced) effects: sold-but-not-synced units are already gone.
  const pendingStock = pendingEffects(snap, ops, vanId).stock;
  const stockOf = (pid: string) => (vanStock[pid] ?? snapStock?.[pid] ?? 0) + (pendingStock[pid] ?? 0);
  /// Sellable right now (free): holds split when present, else the total.
  const freeOf = (pid: string) => (freeMap ? (freeMap[pid] ?? 0) : stockOf(pid)) + (pendingStock[pid] ?? 0);

  const filteredProducts = effProducts.filter(
    (p) =>
      (stockOf(p.id) ?? 0) > 0 &&
      (!cat || p.category?.id === cat) &&
      (!pq || p.name.includes(pq) || (p.reference ?? "").includes(pq))
  );

  function onScan(text: string) {
    const code = text.includes("/") ? text.split("/").pop()! : text;
    const match = (rows: Client[]) => rows.find((c) => c.code === code) ?? rows[0];
    fetch(`/api/clients?q=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Client[]) => {
        const hit = match(rows);
        if (hit) {
          setClient(hit);
          setScanned(true);
          setScanOpen(false);
          beepAdd();
        }
      })
      .catch(() => {
        // Offline: match the synced client list.
        const hit = snap ? match(snap.clients as unknown as Client[]) : undefined;
        if (hit) {
          setClient(hit);
          setScanned(true);
          setScanOpen(false);
          beepAdd();
        }
      });
  }

  function packOf(p: Prod) {
    return p.conversions
      .filter((c) => Number(c.factor) > 1)
      .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
  }

  function closeQty() {
    setQtyFor(null);
    setEditingIdx(null);
  }

  function openQty(p: Prod) {
    const idx = lines.findIndex((l) => l.productId === p.id);
    if (idx >= 0) {
      // Already in the facture: edit its single line (prefill its qty).
      const ex = lines[idx];
      const exPack = p.conversions
        .filter((c) => Number(c.factor) > 1)
        .sort((a, b) => Number(a.factor) - Number(b.factor))[0];
      const isPack = !!exPack && ex.unitId === exPack.unitId;
      setEditingIdx(idx);
      setQtyFor(p);
      setQtyPacks(isPack ? Math.max(0, Math.floor(Number(ex.qty))) : 0);
      setQtyUnits(isPack ? 0 : Math.max(0, Math.floor(Number(ex.qty))));
    } else {
      setEditingIdx(null);
      setQtyFor(p);
      setQtyPacks(1);
      setQtyUnits(0);
    }
    setFreshStock(null);
    // Fresh FREE stock for this product (cards may be stale).
    fetch(`/api/vans/${vanId}/holds`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const hit = d?.holds?.find((h: { productId: string; vanStock: number; free: number }) => h.productId === p.id);
        if (hit) setFreshStock(Number(hit.free ?? hit.vanStock));
        else if (snap?.holds) {
          const s = snap.holds.find((h) => h.productId === p.id);
          if (s) setFreshStock(Number(s.free));
        }
      })
      .catch(() => {
        // Offline: snapshot holds from the last sync.
        const s = snap?.holds?.find((h) => h.productId === p.id);
        if (s) setFreshStock(Number(s.free));
      });
  }

  function addQty() {
    if (!qtyFor) return;
    const p = qtyFor;
    const pack = packOf(p);
    const live = freshStock ?? freeOf(p.id);
    // Editing: the line's current qty goes back to the available pool.
    const cur = editingIdx != null ? lines[editingIdx] ?? null : null;
    const f = pack ? normFactor(Number(pack.factor)) : 0;
    const curBase = cur ? Number(cur.qty) * (pack && cur.unitId === pack.unitId && f ? f : 1) : 0;
    const avail = Math.max(0, live + curBase);
    const packs = f ? Math.min(qtyPacks, Math.floor(avail / f)) : 0;
    const units = Math.min(qtyUnits, Math.floor(avail));
    const opts = saleUnits({ ...p, conversions: p.conversions.map((c) => ({ ...c, factor: Number(c.factor) })) } as never, allowPieces);
    const base = priceFor(p, client?.tierId ?? null);
    const row =
      pack && packs > 0
        ? { productId: p.id, unitId: pack.unitId, qty: packs, unitPrice: priceForUnit(base, f) }
        : units > 0 && opts.some((o) => o.id === (p.baseUnitId ?? ""))
          ? { productId: p.id, unitId: p.baseUnitId, qty: units, unitPrice: base }
          : units > 0
            ? { productId: p.id, unitId: null, qty: units, unitPrice: base }
            : null;
    if (!row) {
      // Zeroed while editing: drop the line instead of keeping a 0 line.
      if (editingIdx != null) setLines((prev) => prev.filter((_, j) => j !== editingIdx));
      closeQty();
      return;
    }
    if (editingIdx != null) {
      setLines((prev) => prev.map((l, j) => (j === editingIdx ? row : l)));
    } else {
      setLines((prev) => [...prev, row]);
    }
    beepAdd();
    closeQty();
  }

  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  function bump(i: number, d: number) {
    setLines((prev) =>
      prev.map((l, j) => (j === i ? { ...l, qty: Math.max(0, l.qty + d) } : l)).filter((l) => l.qty > 0)
    );
  }

  async function confirmSale() {
    if (!lines.length || saving || submittingRef.current) return;
    submittingRef.current = true;
    try {
      if (qrStrict && (!client || !scanned)) {
        setError("qr_required");
        setScanOpen(true);
        return;
      }
      const paidNow = paid === "" ? total : Number(paid);
      // Mirror the server's rules locally so an offline sale the PC would
      // reject is caught BEFORE goods change hands.
      const check = checkOfflineSale({
        snap,
        ops,
        channel: "VAN",
        clientId: client?.id ?? null,
        lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice, remise: 0 })),
        remise: 0,
        paid: paidNow,
        qrScanned: scanned,
        vanId,
      });
      if (!check.ok) {
        setError(check.error);
        if (check.error === "qr_required") setScanOpen(true);
        return;
      }
      // Snapshot for the print preview (lines/client are cleared below).
      const snapLines = lines.map((l) => ({
        name: (effProducts.find((p) => p.id === l.productId)?.name) ?? products.find((p) => p.id === l.productId)?.name ?? "",
        qty: l.qty,
        baseQty: null as number | null,
        unitPrice: l.unitPrice,
        lineTotal: l.qty * l.unitPrice,
      }));
      const snapClient = client;
      const snapTotal = total;
      const snapPaid = paidNow;
      setSaving(true);
      setError(null);
      const body = {
        clientId: client?.id ?? null,
        locationId: vanId,
        tierId: client?.tierId ?? null,
        channel: "VAN",
        tourneeId,
        qrScanned: scanned,
        paid: paidNow,
        lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice, remise: 0 })),
      };
      try {
        const res = await fetch("/api/sales/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          setError(d?.error ?? "failed");
          return;
        }
        beepConfirm();
        setDoneId(d.id);
        setDoneQueued(false);
        setDoneTicket({
          number: d.number,
          date: d.date,
          total: d.total,
          paid: d.paid,
          remise: d.remise ?? 0,
          // Server balance is read before posting → old debt as returned.
          oldDebt: d.client ? Number(d.client.balance ?? 0) : null,
          newDebt: d.client ? Number(d.client.balance ?? 0) + (Number(d.total) - Number(d.paid)) : null,
          client: d.client ? { name: d.client.name, code: d.client.code, phone: d.client.phone ?? null, tierName: d.client.tier?.name ?? null } : null,
          location: d.location ? { name: d.location.name } : { name: vanName },
          seller: null,
          sellerPhone: null,
          lines: (d.lines ?? []).map((l: { product?: { name?: string }; name?: string; qty: number | string; baseQty?: number | string | null; unitPrice: number | string; lineTotal: number | string }) => ({
            name: l.product?.name ?? l.name ?? "",
            qty: l.qty,
            baseQty: l.baseQty ?? null,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
        });
        setLines([]);
        setShowFacture(false);
      } catch {
        // Offline: queue the ticket, it syncs as an immediate sale later.
        // Preview renders from the local snapshot (number assigned on sync).
        try {
          await queueOp("ticket", body as unknown as Record<string, unknown>);
          setOps(await getOutbox());
        } catch {
          setError("save_failed");
          return;
        }
        beepConfirm();
        setDoneId("queued");
        setDoneQueued(true);
        setDoneTicket({
          number: "…",
          date: new Date().toISOString(),
          total: snapTotal,
          paid: snapPaid,
          remise: 0,
          oldDebt: snapClient ? Number(snapClient.balance ?? 0) : null,
          newDebt: snapClient ? Number(snapClient.balance ?? 0) + (snapTotal - snapPaid) : null,
          client: snapClient ? { name: snapClient.name, code: snapClient.code, phone: snapClient.phone, tierName: null } : null,
          location: { name: vanName },
          seller: null,
          sellerPhone: null,
          lines: snapLines,
        });
        setLines([]);
        setShowFacture(false);
      } finally {
        setSaving(false);
      }
    } finally {
      submittingRef.current = false;
    }
  }

  // Ticket QR for the preview (same payload as the print page).
  useEffect(() => {
    if (!doneTicket || doneTicket.number === "…") return;
    let dead = false;
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(JSON.stringify({ app: "distribuili", type: "ticket", n: doneTicket.number }), { margin: 1, width: 160 })
      )
      .then((url) => { if (!dead) setTicketQr(url); })
      .catch(() => {});
    return () => { dead = true; };
  }, [doneTicket]);

  function doPrint() {
    document.body.classList.add("ticket-printing");
    const done = () => document.body.classList.remove("ticket-printing");
    window.addEventListener("afterprint", done, { once: true });
    window.setTimeout(done, 2500);
    window.print();
  }

  function ticketText(): string {
    if (!doneTicket) return "";
    const L = [
      ticketCo?.company.name ?? "",
      ticketCo?.company.phone ?? "",
      `N° ${doneTicket.number}`,
      doneTicket.client ? `${doneTicket.client.name} (${doneTicket.client.code ?? ""})` : "",
      "----------------",
      ...doneTicket.lines.map((l) => `${l.name}  ${l.qty} x ${l.unitPrice} = ${l.lineTotal}`),
      "----------------",
      `${ticketLabels.total}: ${doneTicket.total}`,
      `${ticketLabels.paid}: ${doneTicket.paid}`,
      `${ticketLabels.due}: ${Number(doneTicket.total) - Number(doneTicket.paid)}`,
      ticketLabels.thanks,
    ];
    return L.filter((x) => x !== "").join("\n");
  }

  async function doShare() {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: `N° ${doneTicket?.number ?? ""}`, text: ticketText() });
    } catch {
      // Web fallback: copy to clipboard.
      try {
        await navigator.clipboard.writeText(ticketText());
      } catch { /* ignore */ }
    }
  }

  function closeDone() {
    setDoneId(null);
    setDoneTicket(null);
    setTicketQr(null);
  }

  function startPress(p: Prod) {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      if (p.images.length) {
        setGallery(p);
        setGIdx(0);
      }
    }, 500);
  }
  function endPress() {
    window.clearTimeout(pressTimer.current);
  }

  return (
    <div className="space-y-3 p-4 pb-28 md:p-5 md:pb-28">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => router.push(`/${locale}/livreur/${day}/dashboard${client ? `?client=${client.id}` : ""}`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <button
          onClick={() => setScanOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-(--brand-500) bg-(--brand-500)/5 p-2.5 text-start"
        >
          <QrCode size={17} className="shrink-0 text-(--brand-600)" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{client ? client.name : labels.scanTitle}</span>
            <span className="block truncate font-mono text-[11px] opacity-60" dir="ltr">{client?.code ?? labels.scanHint}</span>
          </span>
        </button>
      </div>

      {!showFacture ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.searchProduct} value={pq} onChange={(e) => setPq(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button onClick={() => setCat("")} className={cn("min-h-11 shrink-0 rounded-full px-3 py-2 text-xs font-black", cat === "" ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken) opacity-70")}>
              {labels.allCats}
            </button>
            {effCategories.map((c) => (
              <button key={c.id} onClick={() => setCat(cat === c.id ? "" : c.id)} className={cn("min-h-11 max-w-28 shrink-0 truncate rounded-full px-3 py-2 text-xs font-black", cat === c.id ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken) opacity-70")}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filteredProducts.map((p) => {
              const img = p.images[0]?.url;
              const base = priceFor(p, client?.tierId ?? null);
              const pack = p.conversions.filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
              const stock = freeOf(p.id);
              const held = heldMap[p.id] ?? 0;
              const f = pack ? normFactor(Number(pack.factor)) : 0;
              const whole = f ? Math.floor(stock / f) : 0;
              const rest = f ? Math.round((stock - whole * f) * 1000) / 1000 : 0;
              const packPrice = pack ? base * f : 0;
              const inSale = lines.find((l) => l.productId === p.id);
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openQty(p)}
                  onTouchStart={() => startPress(p)}
                  onTouchEnd={endPress}
                  onTouchMove={endPress}
                  onMouseDown={() => startPress(p)}
                  onMouseUp={endPress}
                  onMouseLeave={endPress}
                  onKeyDown={(e) => e.key === "Enter" && openQty(p)}
                  className="relative overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)"
                >
                  {inSale && (
                    <span className="absolute end-1.5 top-1.5 z-10 rounded-full bg-(--brand-500) px-2 py-0.5 text-[11px] font-black tabular-nums text-white" dir="ltr">
                      ×{dzMoney(Number(inSale.qty))}
                    </span>
                  )}
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt={p.name} className="aspect-[4/3] w-full object-cover" loading="lazy" draggable={false} />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-(--bg-sunken) text-2xl opacity-50">📦</div>
                  )}
                  <div className="space-y-1 p-2">
                    <div className="truncate text-[13px] font-bold">{p.name}</div>
                    {pack ? (
                      <div className="grid grid-cols-2 gap-1">
                        <div className="rounded-lg bg-(--brand-500)/10 px-1.5 py-1">
                          <div className="truncate text-[9px] font-black uppercase opacity-60">{pack.unit.name}</div>
                          <div className="truncate text-[12px] font-black tabular-nums text-(--brand-600)" dir="ltr">{dzMoney(packPrice)}</div>
                        </div>
                        <div className="rounded-lg bg-(--bg-sunken) px-1.5 py-1">
                          <div className="truncate text-[9px] font-black uppercase opacity-60">{p.baseUnit?.name ?? ""}</div>
                          <div className="truncate text-[12px] font-black tabular-nums" dir="ltr">{dzMoney(base)}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-(--brand-500)/10 px-1.5 py-1">
                        <div className="truncate text-[9px] font-black uppercase opacity-60">{p.baseUnit?.name ?? ""}</div>
                        <div className="truncate text-[12px] font-black tabular-nums text-(--brand-600)" dir="ltr">{dzMoney(base)}</div>
                      </div>
                    )}
                    <div className={cn("rounded-lg bg-(--bg-sunken) px-1.5 py-1 text-[10px] font-bold tabular-nums", stock < 0 ? "text-red-500" : "")}>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="opacity-60">{labels.stock}</span>
                        <span><bdi>{pack ? whole : stock}</bdi> {pack ? pack.unit.name : (p.baseUnit?.name ?? "")}</span>
                      </div>
                      {pack && (
                        <>
                          <div className="flex items-baseline justify-between gap-1 opacity-80">
                            <span className="opacity-60">1 {pack.unit.name} =</span>
                            <span><bdi>{f}</bdi> {p.baseUnit?.name ?? ""}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-1 opacity-80">
                            <span className="opacity-60">{labels.total}</span>
                            <span><bdi>{whole * f}</bdi> {p.baseUnit?.name ?? ""}</span>
                          </div>
                        </>
                      )}
                      {held > 0 && (
                        <div className="flex items-baseline justify-between gap-1 text-amber-600">
                          <span className="opacity-60">🔒 {labels.held ?? "held"}</span>
                          <span><bdi>{pack ? Math.floor(held / (f || 1)) : held}</bdi> {pack ? pack.unit.name : (p.baseUnit?.name ?? "")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {lines.map((l, i) => {
              const p = effProducts.find((x) => x.id === l.productId);
              return (
                <div key={i} className="rounded-xl border border-(--border-default) p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate text-[13px] font-bold">{p?.name ?? l.productId.slice(-4)}</div>
                    <div className="shrink-0 text-sm font-black tabular-nums" dir="ltr">{dzMoney(l.qty * l.unitPrice)}</div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <div className="text-[11px] tabular-nums opacity-60" dir="ltr">{dzMoney(l.unitPrice)}</div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button aria-label="-" onClick={() => bump(i, -1)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--bg-sunken)">
                        <Minus size={15} />
                      </button>
                      <span className="w-8 text-center text-sm font-black tabular-nums">{l.qty}</span>
                      <button aria-label="+" onClick={() => bump(i, 1)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--bg-sunken)">
                        <Plus size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {lines.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
          </div>
          <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) px-3 py-2.5">
            <span className="text-sm font-black">{labels.total}</span>
            <span className="text-lg font-black tabular-nums" dir="ltr">{dzMoney(total)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-bold opacity-70">{labels.paid}</span>
            <Input value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" placeholder={dzMoney(total)} dir="ltr" />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <Button onClick={() => void confirmSale()} disabled={saving || !lines.length} className="h-12 w-full text-base">
            {saving ? "…" : `${labels.confirm} · ${dzMoney(total)}`}
          </Button>
        </div>
      )}

      {/* Bottom arrow: products ⇄ facture */}
      <button
        onClick={() => setShowFacture((v) => !v)}
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-2 border-t border-(--border-default) bg-(--bg-overlay) py-3 text-sm font-black shadow-[0_-4px_16px_rgba(0,0,0,0.08)] lg:bottom-0"
      >
        <ArrowDownUp size={17} className="text-(--brand-600)" />
        {showFacture ? labels.backToProducts : `${labels.facture} · ${lines.length} · ${dzMoney(total)}`}
      </button>

      {/* Scan popup — locked: no ✕, no skip, no manual pick. The sale
          cannot start until the client QR is scanned (camera or gallery). */}
      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title={labels.scanTitle} subtitle={vanName} icon={<QrCode size={18} />} locked>
        <div className="space-y-3">
          <CameraBox
            hint={labels.scanHint}
            onDetect={(t) => { onScan(t); }}
            labels={{
              scan: labels.scan ?? labels.scanTitle,
              gallery: labels.gallery ?? "gallery",
              qrNotFound: labels.qrNotFound ?? "qr_not_found",
              camNeedHttps: labels.camNeedHttps ?? "",
              camDenied: labels.camDenied ?? "",
              camUnsupported: labels.camUnsupported ?? "",
            }}
          />
          <Button variant="secondary" onClick={() => router.push(`/${locale}/livreur/${day}/dashboard`)} className="w-full">
            <ArrowLeft size={15} className="me-1 rtl:rotate-180" />
            {labels.backToDash ?? labels.backToProducts}
          </Button>
        </div>
      </Modal>

      {/* Qty popup — centered, with van stock cap */}
      {qtyFor && (() => {
        const pack = packOf(qtyFor);
        const base = priceFor(qtyFor, client?.tierId ?? null);
        const live = freshStock ?? freeOf(qtyFor.id);
        const avail = Math.max(0, live);
        const f = pack ? normFactor(Number(pack.factor)) : 0;
        const packs = f ? Math.floor(avail / f) : 0;
        const rest = f ? Math.round((avail - packs * f) * 1000) / 1000 : 0;
        const maxPacks = packs;
        const maxUnits = Math.floor(avail);
        const packFull = qtyPacks >= maxPacks;
        const unitFull = qtyUnits >= maxUnits;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <button type="button" aria-label={labels.cancel} onClick={() => closeQty()} className="absolute inset-0 bg-black/55" />
            <div className="relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-2xl">
              <div className="mb-1 truncate text-base font-black">{qtyFor.name}</div>
              <div className={cn("mb-2 rounded-xl bg-(--bg-sunken) p-2.5", live < 0 ? "text-red-500" : "")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold opacity-60">{labels.stock}</span>
                  <span className="text-base font-black tabular-nums"><bdi>{packs}</bdi> {pack ? pack.unit.name : (qtyFor.baseUnit?.name ?? "")}{pack && rest > 0 ? <> + <bdi>{rest}</bdi> {qtyFor.baseUnit?.name ?? ""}</> : null}</span>
                </div>
                {pack && (
                  <div className="mt-1 space-y-0.5 border-t border-(--border-default) pt-1 text-xs font-bold tabular-nums opacity-80">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="opacity-60">1 {pack.unit.name} =</span>
                      <span><bdi>{f}</bdi> {qtyFor.baseUnit?.name ?? ""}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="opacity-60">{labels.total}</span>
                      <span><bdi>{live}</bdi> {qtyFor.baseUnit?.name ?? ""}</span>
                    </div>
                  </div>
                )}
              </div>
              {pack && (
                <div className="mb-2 flex items-center justify-between rounded-xl bg-(--bg-sunken) p-3">
                  <div>
                    <div className="text-sm font-black">{pack.unit.name}</div>
                    <div className="text-base font-black tabular-nums text-(--brand-600)" dir="ltr">{dzMoney(base * f)}</div>
                    <div className="text-[11px] tabular-nums opacity-60" dir="ltr">{dzMoney(base)} / {qtyFor.baseUnit?.name ?? ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button aria-label="-" onClick={() => setQtyPacks((v) => Math.max(0, v - 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default)">
                      <Minus size={17} />
                    </button>
                    <span className="w-10 text-center text-xl font-black tabular-nums">{qtyPacks}</span>
                    <button aria-label="+" onClick={() => setQtyPacks((v) => Math.min(maxPacks, v + 1))} disabled={packFull} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default) disabled:opacity-30">
                      <Plus size={17} />
                    </button>
                  </div>
                </div>
              )}
              {(!pack || allowPieces) && (
              <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) p-3">
                <div>
                  <div className="text-sm font-black">{labels.colis}</div>
                  <div className="text-xs tabular-nums opacity-60" dir="ltr">{dzMoney(base)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button aria-label="-" onClick={() => setQtyUnits((v) => Math.max(0, v - 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default)">
                    <Minus size={17} />
                  </button>
                  <span className="w-10 text-center text-xl font-black tabular-nums">{qtyUnits}</span>
                  <button aria-label="+" onClick={() => setQtyUnits((v) => Math.min(maxUnits, v + 1))} disabled={unitFull} className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border-default) disabled:opacity-30">
                    <Plus size={17} />
                  </button>
                </div>
              </div>
              )}
              <div className="mt-3 flex gap-2">
                  <Button variant="secondary" onClick={() => closeQty()} className="flex-1">{labels.cancel}</Button>
                <Button onClick={addQty} disabled={qtyPacks <= 0 && qtyUnits <= 0} className="flex-[2]">{labels.confirm}</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Image gallery (long-press, swipe) */}
      <Modal open={gallery !== null} onClose={() => setGallery(null)} title={gallery?.name ?? ""} subtitle="" icon="🖼">
        {gallery && (
          <div
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (touchX.current == null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 40) {
                setGIdx((i) => (dx < 0 ? Math.min(gallery.images.length - 1, i + 1) : Math.max(0, i - 1)));
              }
              touchX.current = null;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gallery.images[gIdx]?.url} alt={gallery.name} className="max-h-[60vh] w-full rounded-xl object-contain" />
            {gallery.images.length > 1 && (
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <button aria-label="prev" onClick={() => setGIdx((i) => Math.max(0, i - 1))} className="rounded-lg bg-(--bg-sunken) px-3 py-2 font-black">‹</button>
                {gallery.images.map((_, i) => (
                  <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i === gIdx ? "bg-(--brand-500)" : "bg-(--border-default)")} />
                ))}
                <button aria-label="next" onClick={() => setGIdx((i) => Math.min(gallery.images.length - 1, i + 1))} className="rounded-lg bg-(--bg-sunken) px-3 py-2 font-black">›</button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Done → print preview popup (or queued note when offline).
          Rendered in a body-level portal so the print CSS can isolate the
          ticket from the rest of the page. */}
      {doneId !== null && (doneQueued || !doneTicket || typeof document === "undefined"
        ? (
          <Modal open onClose={closeDone} title={labels.saved} subtitle="" icon={<Check size={18} />}>
            <p className="text-xs font-bold opacity-60">{labels.ticketQueued ?? labels.printHint}</p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={closeDone} className="flex-1">{labels.cancel}</Button>
            </div>
          </Modal>
        )
        : createPortal(
          <div className="ticket-print-scope fixed inset-0 z-[70] overflow-y-auto bg-black/60 p-3">
            <div className="mx-auto w-fit max-w-full">
              <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
                <TicketView
                  ticket={doneTicket}
                  company={ticketCo?.company ?? { name: "" }}
                  width={ticketCo?.width ?? "80"}
                  locale={ticketLang}
                  labels={ticketLabels}
                  qrDataUrl={ticketQr}
                  lang={ticketLang}
                />
              </div>
              <div className="no-print mx-auto mt-2 flex max-w-full gap-2 pb-6" style={{ width: `${ticketCo?.width ?? "80"}mm` }}>
                <Button variant="secondary" onClick={closeDone} className="flex-1" aria-label={labels.cancel}>
                  <X size={16} />
                </Button>
                {isNative && (
                  <Button variant="secondary" onClick={() => void doShare()} className="flex-1">
                    <Share2 size={16} className="me-1" />
                    {ticketLabels.share}
                  </Button>
                )}
                <Button onClick={doPrint} className="flex-[2]">
                  <Printer size={16} className="me-1" />
                  {labels.print}
                </Button>
              </div>
              <div className="no-print mx-auto max-w-full pb-8 text-center" style={{ width: `${ticketCo?.width ?? "80"}mm` }}>
                <Link href={`/${locale}/sales/${doneId}/ticket`} target="_blank" className="text-xs font-bold text-white/80 underline">
                  {labels.printTitle ?? labels.print}
                </Link>
              </div>
            </div>
          </div>,
          document.body
        ))}
    </div>
  );
}
