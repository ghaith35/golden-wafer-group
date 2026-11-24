"use client";

import { matchClient } from "@/lib/clients/display";
import { ClientName } from "@/components/clients/ClientName";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Minus, Plus, Printer, QrCode, Search, Share2, ShoppingBag, Trash2, X } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { CameraBox } from "@/components/scan/CameraBox";
import { TicketView, type TicketLabels, type TicketVM } from "@/components/sales/TicketView";
import { factorOf, normFactor, priceForUnit, saleUnits } from "@/components/products/UnitQty";
import { mergeTiers, resolveTierPrice } from "@/lib/pricing";
import { beepAdd, beepConfirm } from "@/lib/beep";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getVanSnapshot, getOutbox, getPendingClients, findScannedClient, serverUnreachable, queueOp, goPage, saleErrText, queueErrText, type VanSnapshot } from "@/lib/sync/client";
import { PdfViewer } from "@/components/sales/PdfViewer";
import { printTicketNative } from "@/lib/print-ticket";

import { checkOfflineSale, pendingEffects } from "@/lib/sync/offline-rules";
import { DealChip, GiftLineRow, colisMap, giftBodyLines, giftProductsFrom, lineBaseQty, useDealLines, useGifts, useThreePackRules } from "@/components/threepack/useThreePack";
import type { OutboxRow } from "@/lib/sync/offline-db";

import { ErrText } from "@/components/ui/ErrText";
type Client = { id: string; name: string; code: string; phone: string | null; gpsLat?: number | string | null; gpsLng?: number | string | null; tierId: string | null; balance: unknown };
type Prod = {
  id: string; name: string; reference: string | null;
  salePrice: unknown; baseUnitId: string | null;
  baseUnit: { id: string; name: string } | null;
  images: Array<{ url: string }>;
  tierPrices: Array<{ tierId: string; price: unknown }>;
  conversions: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
  category: { id: string; name: string } | null;
};
type Line = { productId: string; unitId: string | null; qty: number; unitPrice: number; tierId: string | null };

function priceFor(p: Prod, tierId: string | null): number {
  return resolveTierPrice(p.tierPrices, p.salePrice, tierId);
}

/// Step 4 — Vente as a PAGE: scan popup → products → qty sheet → facture → print.
export function VenteClient({
  locale,
  day,
  companyId,
  vanId,
  vanName,
  tourneeId,
  listTourneeId = null,
  initialClient,
  products,
  categories,
  vanStock,
  tiers,
  allowPieces,
  labels,
  ticketLabels,
  ticketLang,
  driver,
  editingTicket = null,
}: {
  locale: string;
  day: string;
  companyId: string;
  vanId: string;
  vanName: string;
  tourneeId: string | null;
  /// Picked day's tour (its client list) — only used so its clients aren't flagged off-tour.
  listTourneeId?: string | null;
  initialClient: Client | null;
  products: Prod[];
  categories: Array<{ id: string; name: string }>;
  vanStock: Record<string, number>;
  tiers: Array<{ id: string; name: string }>;
  allowPieces: boolean;
  labels: Record<string, string>;
  ticketLabels: TicketLabels;
  ticketLang: "ar" | "fr";
  /// Logged-in driver: name + phone printed on every ticket.
  driver?: { fullName: string; phone: string | null } | null;
  /// Edit mode: rewrite a posted ticket (factures ✎) — lines/paid prefilled,
  /// client locked, save goes back to the factures list (no print preview).
  editingTicket?: {
    id: string;
    paid: number;
    notes: string | null;
    lines: Array<{ productId: string; unitId: string | null; qty: number; unitPrice: number }>;
  } | null;
}) {
  const router = useRouter();
  /// The scan popup is only FORCED when "QR strict" is on (opened by the
  /// settings check below, or by a qr_required rejection). With strict OFF the
  /// driver may scan, pick a client by name/code, or sell without one.
  const [scanOpen, setScanOpen] = useState(false);
  const [clientQ, setClientQ] = useState("");
  const [clientHits, setClientHits] = useState<Client[]>([]);
  const scanning = useRef(false);
  const [scanError, setScanError] = useState<string | null>(null);
  /// Strict QR (settings toggle ON): only a real scan counts, and the server
  /// rejects the ticket otherwise.
  const [qrStrict, setQrStrict] = useState(false);
  const [scanned, setScanned] = useState(false);
  /// Live server value of "QR strict" (null = unknown/offline). When known it
  /// wins over the possibly stale synced snapshot copy in every check.
  const [liveQr, setLiveQr] = useState<boolean | null>(null);
  const [client, setClient] = useState<Client | null>(initialClient);
  /// Price-tier toggle: which category NEW lines take. Defaults to the
  /// client's own category (each client opens on his prices); switching
  /// never rewrites lines already in the facture — a sale can mix tiers.
  const [selTier, setSelTier] = useState<string | null>(initialClient?.tierId ?? null);
  useEffect(() => {
    setSelTier(client?.tierId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);
  const [cat, setCat] = useState("");
  const [menu, setMenu] = useState<null | "tier" | "cat">(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const [pq, setPq] = useState("");
  const [lines, setLines] = useState<Line[]>(
    editingTicket?.lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice, tierId: null })) ?? []
  );
  const [showFacture, setShowFacture] = useState(false);
  /// On-screen keyboard height: the cart bar hides while typing (search).
  const kbInset = useKeyboardInset();
  // The floating cart bar is portaled — only after mount, so SSR and the
  // first client render match (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  /// Small haptic tick when a product is added to the order (phones).
  const prevLineCount = useRef(0);
  useEffect(() => {
    if (lines.length > prevLineCount.current) {
      try { navigator.vibrate?.(12); } catch { /* unsupported */ }
    }
    prevLineCount.current = lines.length;
  }, [lines.length]);
  const [qtyFor, setQtyFor] = useState<Prod | null>(null);
  const [qtyPacks, setQtyPacks] = useState(1);
  const [qtyUnits, setQtyUnits] = useState(0);
  /// Edit mode: tapping a product already in the facture edits its single
  /// line — one line per product, never duplicates.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [paid, setPaid] = useState(editingTicket ? String(editingTicket.paid) : "");
  /// true once the driver typed his OWN received amount (partial payment).
  /// Until then "المقبوض" always equals "المجموع" — it follows every cart change
  /// (qty +/-, added line, deal/gift repricing), never a stale first total.
  const [paidTouched, setPaidTouched] = useState(!!editingTicket);
  /// The order in progress is backed up in this tab's session storage, so a
  /// reload for ANY reason (offline switch, app update, accidental refresh)
  /// never costs the driver his selection. Per van + client; cleared the moment
  /// the sale is saved (online or queued) or the cart is emptied.
  const draftKey = `dili_sale_draft_v1:${vanId}:${client?.id ?? ""}`;
  useEffect(() => {
    if (editingTicket) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { t?: number; lines?: Line[]; paid?: string; paidTouched?: boolean };
      if (!d.t || Date.now() - d.t > 6 * 3600_000 || !Array.isArray(d.lines) || !d.lines.length) {
        sessionStorage.removeItem(draftKey);
        return;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore on mount
      setLines(d.lines);
      if (typeof d.paid === "string") setPaid(d.paid);
      if (d.paidTouched) setPaidTouched(true);
    } catch { /* corrupt draft: ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (editingTicket) return;
    try {
      if (lines.length) sessionStorage.setItem(draftKey, JSON.stringify({ t: Date.now(), lines, paid, paidTouched }));
      else sessionStorage.removeItem(draftKey);
    } catch { /* storage full / private mode */ }
  }, [lines, paid, paidTouched, draftKey, editingTicket]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Silent sale-site fix (admin eyes only — no UI, never blocks the sale):
  /// warmed while the driver builds the facture so a fix is usually ready
  /// at save time; null when denied/unavailable.
  const siteFix = useRef<{ lat: number; lng: number } | null>(null);
  function warmSiteFix() {
    try {
      if (!("geolocation" in navigator)) return;
      navigator.geolocation.getCurrentPosition(
        (p) => {
          siteFix.current = { lat: p.coords.latitude, lng: p.coords.longitude };
        },
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
      );
    } catch { /* never break the sale */ }
  }
  useEffect(() => {
    warmSiteFix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [doneQueued, setDoneQueued] = useState(false);
  /// Print preview: created ticket (server response or local snapshot when
  /// offline) + company header/width for the TicketView.
  const [doneTicket, setDoneTicket] = useState<TicketVM | null>(null);
  const [ticketCo, setTicketCo] = useState<{ company: { name: string; phone?: string | null; address?: string | null; rc?: string | null; nif?: string | null; nis?: string | null; logoUrl?: string | null }; width: "80"; currency: string } | null>(null);
  const [ticketQr, setTicketQr] = useState<string | null>(null);
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
  /// Tier catalogue: server props merged with the fresher snapshot.
  const effTiers = mergeTiers(tiers, snap?.tiers);
  const tierName = (id: string | null) =>
    id == null ? (labels.tierBase ?? "") : (effTiers.find((t) => t.id === id)?.name ?? labels.tierBase ?? "");
  /// Queued (unsynced) ops — their effects are subtracted from local stock so
  /// an offline sale can't promise the same units twice.
  const [ops, setOps] = useState<OutboxRow[]>([]);

  useEffect(() => {
    getVanSnapshot().then(setSnap).catch(() => {});
    getOutbox().then(setOps).catch(() => {});
    // Warm this exact page URL (query included) so back-navigation works offline.
    try {
      void import("@/lib/sync/client").then((m) => m.prefetchPages([window.location.href])).catch(() => {});
    } catch { /* never break the page */ }
  }, []);
  const pressTimer = useRef(0);
  const touchX = useRef<number | null>(null);
  /// Synchronous double-tap guard (state updates are async).
  const submittingRef = useRef(false);

  useEffect(() => {
    let dead = false;
    fetch("/api/settings/public", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead) return;
        if (d && typeof d.qrStrictMode === "boolean") setLiveQr(d.qrStrictMode);
        if (d?.qrStrictMode && !editingTicket) {
          setQrStrict(true);
          setScanned(false);
          setScanOpen(true);
        }
        setTicketCo({
          company: d?.company ?? { name: "" },
          width: "80",
          currency: d?.currency ?? "DZD",
        });
      })
      .catch(() => {
        // Offline: fall back to the synced snapshot's flag.
        if (!dead) getVanSnapshot().then((s) => {
          if (s?.settings.qrStrictMode && !editingTicket) {
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

  /// Manual client pick (strict OFF): the full client list shows as soon as
  /// the popup opens; typing filters it. Snapshot + pending clients offline.
  useEffect(() => {
    if (!scanOpen || qrStrict) return;
    const q = clientQ.trim().toLowerCase();
    let dead = false;
    const id = window.setTimeout(() => {
      fetch(q ? `/api/clients?q=${encodeURIComponent(clientQ.trim())}` : "/api/clients", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((rows: Array<Client & { isActive?: boolean }>) => {
          if (!dead) setClientHits(rows.filter((c) => c.isActive !== false).slice(0, 100));
        })
        .catch(async () => {
          const pool = ((snap?.clients ?? []) as unknown as Client[]);
          let pend: Client[] = [];
          try {
            pend = (await getPendingClients()).map((p) => ({ id: `pending:${p.opId}`, name: p.name, code: p.code, phone: p.phone, tierId: p.tierId, balance: 0 }));
          } catch { /* ignore */ }
          const all = [...pend, ...pool];
          const hit = clientQ.trim() ? all.filter((c) => matchClient(clientQ, c)) : all;
          if (!dead) setClientHits(hit.slice(0, 100));
        });
    }, q ? 250 : 0);
    return () => { dead = true; window.clearTimeout(id); };
  }, [clientQ, scanOpen, qrStrict, snap]);

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

  // 3pack: free colis appear on their own in the facture (read-only, price 0).
  // Rules: live from the server when reachable, else the synced snapshot.
  const t3 = useTranslations("threepack");
  const tpRules = useThreePackRules(snap, true);
  const giftProducts = useMemo(() => giftProductsFrom(products, snap?.products), [products, snap]);
  const gifts = useGifts(tpRules, giftProducts, lines);
  const giftLines = useMemo(() => giftBodyLines(gifts), [gifts]);
  // % off / new-price deals: the cart is re-priced here (same function as the
  // server) so an offline sale shows and queues the final prices.
  const effLines = useDealLines(tpRules, giftProducts, lines, !editingTicket);
  const effCategories = categories.length > 0 ? categories : (snap?.categories ?? []);
  const snapStock = (() => {
    if (!snap) return null;
    const m: Record<string, number> = {};
    for (const b of snap.stock ?? []) m[b.productId] = Number(b.qty);
    return m;
  })();
  /// Pending (unsynced) effects: sold-but-not-synced units are already gone.
  const pendingStock = pendingEffects(snap, ops, vanId).stock;
  /// Base stock without pending effects (server/snapshot truth).
  const baseOf = (pid: string) => vanStock[pid] ?? snapStock?.[pid] ?? 0;
  const stockOf = (pid: string) => baseOf(pid) + (pendingStock[pid] ?? 0);
  /// Sellable right now (free): holds split when present, else the total —
  /// pending applied EXACTLY once (stockOf already includes it).
  const freeOf = (pid: string) => (freeMap ? (freeMap[pid] ?? 0) : baseOf(pid)) + (pendingStock[pid] ?? 0);

  const filteredProducts = effProducts.filter(
    (p) =>
      (stockOf(p.id) ?? 0) > 0 &&
      (!cat || p.category?.id === cat) &&
      (!pq || p.name.includes(pq) || (p.reference ?? "").includes(pq))
  ).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  async function onScan(text: string) {
    if (scanning.current) return;
    scanning.current = true;
    try {
      const hit = await findScannedClient(text, companyId, day);
      if (!hit) {
        setScanError(!snap && serverUnreachable() ? (labels.syncFirst ?? labels.qrNotFound ?? "not_found") : (labels.qrNotFound ?? "not_found"));
        return;
      }
      setScanError(null);
      setClient(hit);
      setScanned(true);
      setScanOpen(false);
      beepAdd();
    } finally {
      scanning.current = false;
    }
  }

  // Deep link with an unsynced client (?client=pending:<opId>): resolve it
  // from this phone's outbox instead of the server.
  useEffect(() => {
    if (initialClient) return;
    let dead = false;
    (async () => {
      try {
        const m = /[?&]client=(pending%3A[^&]+|pending:[^&]+)/.exec(window.location.search);
        if (!m) return;
        const id = decodeURIComponent(m[1]);
        const pend = await getPendingClients();
        const hit = pend.find((p) => `pending:${p.opId}` === id);
        if (hit && !dead) {
          setClient({
            id, name: hit.name, code: hit.code,
            phone: hit.phone, tierId: hit.tierId, balance: 0,
          });
          setScanned(true);
          setScanOpen(false);
        }
      } catch { /* stay on scan */ }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Packless products sell by the unit (the units stepper is the only
      // one shown) — default to 1 unit, not 1 phantom pack, or Confirm
      // silently adds nothing and the driver thinks the button is dead.
      const hasPack = p.conversions.some((c) => Number(c.factor) > 1);
      setQtyPacks(hasPack ? 1 : 0);
      setQtyUnits(hasPack ? 0 : 1);
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
    // New lines take the TOGGLED tier (fallback: base sell). Lines already
    // in the facture keep theirs — the toggle never rewrites them.
    const base = priceFor(p, selTier);
    const row =
      pack && packs > 0
        ? { productId: p.id, unitId: pack.unitId, qty: packs, unitPrice: priceForUnit(base, f), tierId: selTier }
        : units > 0 && opts.some((o) => o.id === (p.baseUnitId ?? ""))
          ? { productId: p.id, unitId: p.baseUnitId, qty: units, unitPrice: base, tierId: selTier }
          : units > 0
            ? { productId: p.id, unitId: null, qty: units, unitPrice: base, tierId: selTier }
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

  const total = effLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  // Exact total (decimals kept when there are any) — same text everywhere it is shown.
  const totalTxt = dzMoney(total, Math.round(total * 100) % 100 !== 0 ? 2 : 0);
  // "المقبوض" follows "المجموع" until the driver types his own amount.
  useEffect(() => {
    if (paidTouched) return;
    setPaid(total > 0 ? String(Math.floor(Math.round(total * 100) / 100)) : "");
  }, [total, paidTouched]);

  function bump(i: number, d: number) {
    setLines((prev) =>
      prev.map((l, j) => (j === i ? { ...l, qty: Math.max(0, l.qty + d) } : l)).filter((l) => l.qty > 0)
    );
  }

  async function confirmSale() {
    if (!lines.length || saving || submittingRef.current) return;
    submittingRef.current = true;
    try {
      if (qrStrict && !editingTicket && (!client || !scanned)) {
        setError("qr_required");
        setScanOpen(true);
        return;
      }
      const paidNow = paid === "" ? total : Number(paid);
      // Mirror the server's rules locally so an offline sale the PC would
      // reject is caught BEFORE goods change hands.
      const check = checkOfflineSale({
        snap: snap && liveQr !== null ? { ...snap, settings: { ...snap.settings, qrStrictMode: liveQr } } : snap,
        ops,
        channel: "VAN",
        clientId: client?.id ?? null,
        lines: [...effLines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice, remise: 0, tierId: l.tierId ?? null })), ...giftLines],
        remise: 0,
        paid: paidNow,
        // Edit mode rewrites server-side (no QR rule there) — don't force a
        // rescan for a ticket that was already accepted.
        qrScanned: scanned || !!editingTicket,
        vanId,
        // Validate the gift against the rules it was computed from.
        bonus: {
          rules: tpRules,
          colis: colisMap(giftProducts),
          baseQtyOf: (l) => lineBaseQty(giftProducts, l),
        },
      });
      if (!check.ok) {
        setError(saleErrText(labels, check.error) ?? "failed");
        if (check.error === "qr_required") setScanOpen(true);
        return;
      }
      // Edit mode: rewrite the posted ticket, then back to the factures
      // list (no print preview — it prints from there). Online only: there is
      // no offline edit op, so say so loudly instead of dying silently.
      if (editingTicket) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setError(labels.offline ?? "offline");
          return;
        }
        setSaving(true);
        setError(null);
        try {
          const res = await fetch(`/api/sales/${editingTicket.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "edit",
              clientId: client?.id ?? null,
              locationId: vanId,
              tierId: client?.tierId ?? null,
              paid: paidNow,
              notes: editingTicket.notes,
              lines: [...effLines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice, remise: 0, tierId: l.tierId ?? null })), ...giftLines],
            }),
          });
          const d = await res.json().catch(() => null);
          if (!res.ok) {
            setError(saleErrText(labels, d?.error) ?? "failed");
            return;
          }
          beepConfirm();
          goPage(router, `/${locale}/livreur/${day}/factures`);
        } catch {
          // Server unreachable mid-edit (dropped connection, not validation).
          setError(labels.offline ?? "offline");
        } finally {
          setSaving(false);
        }
        return;
      }
      // Snapshot for the print preview (lines/client are cleared below).
      const snapLines = effLines.map((l) => ({
        name: (effProducts.find((p) => p.id === l.productId)?.name) ?? products.find((p) => p.id === l.productId)?.name ?? "",
        qty: l.qty,
        baseQty: null as number | null,
        unitPrice: l.unitPrice,
        lineTotal: l.qty * l.unitPrice,
        bonus: false,
      })).concat(
        gifts.map((g) => ({
          name: (effProducts.find((p) => p.id === g.productId)?.name) ?? products.find((p) => p.id === g.productId)?.name ?? "",
          qty: g.colis,
          baseQty: g.baseQty as number | null,
          unitPrice: 0,
          lineTotal: 0,
          bonus: true,
        })),
      );
      const snapClient = client;
      const snapTotal = total;
      const snapPaid = paidNow;
      setSaving(true);
      setError(null);
      // Silent sale-site fix (admin eyes only): whatever fix is warm, or
      // nothing — the sale never waits for GPS.
      const fix = siteFix.current;
      const body = {
        clientId: client?.id ?? null,
        locationId: vanId,
        tierId: client?.tierId ?? null,
        channel: "VAN",
        tourneeId,
        listTourneeId,
        qrScanned: scanned,
        ...(fix ? { saleLat: fix.lat, saleLng: fix.lng } : {}),
        paid: paidNow,
        lines: [...effLines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice, remise: 0, tierId: l.tierId ?? null })), ...giftLines],
      };
      try {
        const res = await fetch("/api/sales/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          if (d?.error === "qr_required") {
            // The server says strict is ON (our copy was stale): enforce now.
            setQrStrict(true);
            setScanned(false);
            setScanOpen(true);
          }
          setError(saleErrText(labels, d?.error) ?? "failed");
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
          seller: driver?.fullName ?? null,
          sellerPhone: driver?.phone ?? null,
          lines: (d.lines ?? []).map((l: { product?: { name?: string }; name?: string; qty: number | string; baseQty?: number | string | null; unitPrice: number | string; lineTotal: number | string; isBonus?: boolean }) => ({
            name: l.product?.name ?? l.name ?? "",
            qty: l.qty,
            baseQty: l.baseQty ?? null,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            bonus: !!l.isBonus,
          })),
        });
        setLines([]);
        setShowFacture(false);
        setPaid("");
        setPaidTouched(false);
        endClientSelection();
      } catch {
        // Offline: queue the ticket, it syncs as an immediate sale later.
        // Preview renders from the local snapshot (number assigned on sync).
        try {
          await queueOp("ticket", body as unknown as Record<string, unknown>);
          setOps(await getOutbox());
        } catch (e) {
          setError(queueErrText(labels, e));
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
          seller: driver?.fullName ?? null,
          sellerPhone: driver?.phone ?? null,
          lines: snapLines,
        });
        setLines([]);
        setShowFacture(false);
        setPaid("");
        setPaidTouched(false);
        endClientSelection();
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

  async function doPrint() {
    // Native APK first: system print dialog with printer selection
    // (window.print() is a no-op inside the WebView).
    if (doneTicket) {
      const res = await printTicketNative({
        ticket: doneTicket,
        company: { name: ticketCo?.company.name ?? "", phone: ticketCo?.company.phone ?? null, address: ticketCo?.company.address ?? null, rc: ticketCo?.company.rc ?? null, nif: ticketCo?.company.nif ?? null, nis: ticketCo?.company.nis ?? null, logoUrl: ticketCo?.company.logoUrl ?? null },
        width: ticketCo?.width ?? "80",
        labels: ticketLabels,
        lang: ticketLang,
        qrDataUrl: ticketQr,
      });
      if (res.ok) return;
      // APK but the dialog didn't open (old shell, no print service…):
      // window.print below is a no-op there — say so loudly (with the
      // reason) instead of a dead button.
      try {
        const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        if (cap?.isNativePlatform?.()) {
          setSharedMsg(`${ticketLabels.printFail ?? "print failed"} (${res.reason})`);
          return;
        }
      } catch { /* fall through to window.print */ }
    }
    document.body.classList.add("ticket-printing");
    const done = () => document.body.classList.remove("ticket-printing");
    window.addEventListener("afterprint", done, { once: true });
    window.setTimeout(done, 2500);
    window.print();
  }

  /// Share opens the in-app PDF viewer (A4 sheet, offline): the driver
  /// sees the facture, then shares/saves the real PDF from inside it.
  /// sharedMsg survives for the print-failure notice (APK without plugin).
  const [pdfView, setPdfView] = useState(false);
  const [sharedMsg, setSharedMsg] = useState<string | null>(null);
  function closeDone() {
    setDoneId(null);
    setDoneTicket(null);
    setTicketQr(null);
    // QR strict: the next sale needs its own scan — ask for it right away.
    if (qrStrict || liveQr) setScanOpen(true);
  }
  /// The sale is finished: the client selection ends with it. The next sale
  /// starts clean (no client, base price tier) — never silently on the previous
  /// customer. The ticket preview keeps its own copy of the client.
  function endClientSelection() {
    setClient(null);
    setScanned(false);
    setScanError(null);
    setClientQ("");
    setClientHits([]);
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
    <div className="space-y-3 p-4 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard${client ? `?client=${client.id}` : ""}`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <button
          onClick={() => setScanOpen(true)}
          disabled={!!editingTicket}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-(--brand-500) bg-(--brand-500)/5 p-2.5 text-start disabled:opacity-80"
        >
          <QrCode size={17} className="shrink-0 text-(--brand-600)" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black">{client ? <ClientName name={client.name} lat={client.gpsLat} lng={client.gpsLng} /> : <span className="block truncate">{labels.scanTitle}</span>}</span>
            <span className="block truncate font-mono text-[11px] opacity-60" dir="ltr">{client?.code ?? labels.scanHint}</span>
          </span>
        </button>
      </div>

      {/* One compact toolbar: price tier ▾ · category ▾ · search 🔍.
          Tier = which price NEW lines take (default: the client's own);
          already-added lines keep their price — a sale can mix tiers. */}
      {(() => {
        const tierLabel = selTier == null ? (labels.tierBase ?? "") : tierName(selTier);
        const catLabel = cat === "" ? labels.allCats : (effCategories.find((c) => c.id === cat)?.name ?? labels.allCats);
        const chip = (active: boolean) =>
          cn(
            "flex min-h-11 w-full min-w-0 items-center justify-between gap-1.5 rounded-2xl border px-3 py-1 text-start text-[13px] font-black shadow-sm transition-colors",
            active
              ? "border-(--brand-500) bg-(--brand-500) text-(--brand-contrast)"
              : "border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)"
          );
        const optCls = (on: boolean) =>
          cn(
            "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-[13px] font-bold transition-colors",
            on ? "bg-(--brand-500)/12 text-(--brand-600)" : "hover:bg-(--bg-sunken)"
          );
        const popover = (children: React.ReactNode) => (
          <>
            <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setMenu(null)} />
            <div className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[min(18rem,50vh)] overflow-y-auto overscroll-contain rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-1.5 shadow-[0_18px_40px_-12px_rgba(15,40,100,0.35)]">
              {children}
            </div>
          </>
        );
        if (searchOpen) {
          return (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-(--brand-600)" />
                <Input
                  autoFocus
                  className="ps-9"
                  placeholder={labels.searchProduct}
                  value={pq}
                  onChange={(e) => setPq(e.target.value)}
                />
              </div>
              <button
                type="button"
                aria-label="close search"
                onClick={() => { setSearchOpen(false); setPq(""); }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-(--border-default) bg-(--bg-overlay)"
              >
                <X size={18} />
              </button>
            </div>
          );
        }
        return (
          <div className="relative flex flex-wrap items-center gap-2">
            {effTiers.length > 0 && (
              <div className="min-w-[8.5rem] flex-1">
                <button type="button" data-testid="tier-trigger" onClick={() => setMenu(menu === "tier" ? null : "tier")} className={chip(menu === "tier")}>
                  <span className="min-w-0 break-words leading-tight">{tierLabel}</span>
                  <ChevronDown size={16} className={cn("shrink-0 transition-transform", menu === "tier" && "rotate-180")} />
                </button>
                {menu === "tier" && (
                  popover(<>
                    <button type="button" data-testid="tier-base" onClick={() => { setSelTier(null); setMenu(null); }} className={optCls(selTier == null)}>
                      <span className="min-w-0 break-words leading-tight">{labels.tierBase ?? ""}</span>
                      {selTier == null && <Check size={16} />}
                    </button>
                    {[...effTiers].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })).map((t) => (
                      <button key={t.id} type="button" data-testid={`tier-${t.id}`} onClick={() => { setSelTier(t.id); setMenu(null); }} className={optCls(selTier === t.id)}>
                        <span className="min-w-0 break-words leading-tight">{t.name}</span>
                        {selTier === t.id && <Check size={16} />}
                      </button>
                    ))}
                  </>)
                )}
              </div>
            )}
            {(
              <div className="min-w-[8.5rem] flex-1">
                <button type="button" data-testid="cat-trigger" onClick={() => setMenu(menu === "cat" ? null : "cat")} className={chip(menu === "cat" || cat !== "")}>
                  <span className="min-w-0 break-words leading-tight">{catLabel}</span>
                  <ChevronDown size={16} className={cn("shrink-0 transition-transform", menu === "cat" && "rotate-180")} />
                </button>
                {menu === "cat" && (
                  popover(<>
                    <button type="button" onClick={() => { setCat(""); setMenu(null); }} className={optCls(cat === "")}>
                      <span className="min-w-0 break-words leading-tight">{labels.allCats}</span>
                      {cat === "" && <Check size={16} />}
                    </button>
                    {[...effCategories].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })).map((c) => (
                      <button key={c.id} type="button" onClick={() => { setCat(c.id); setMenu(null); }} className={optCls(cat === c.id)}>
                        <span className="min-w-0 break-words leading-tight">{c.name}</span>
                        {cat === c.id && <Check size={16} />}
                      </button>
                    ))}
                  </>)
                )}
              </div>
            )}
            {(
              <button
                type="button"
                aria-label={labels.searchProduct}
                onClick={() => { setMenu(null); setSearchOpen(true); }}
                className={cn(
                  "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                  pq ? "border-(--brand-500) bg-(--brand-500) text-(--brand-contrast)" : "border-(--border-default) bg-(--bg-overlay) text-(--brand-600)"
                )}
              >
                <Search size={18} />
              </button>
            )}
          </div>
        );
      })()}

      {/* Products stay on screen; the order lives in a bottom sheet. */}
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.75rem,1fr))] gap-2">
            {filteredProducts.map((p) => {
              const img = p.images[0]?.url;
              const base = priceFor(p, selTier);
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
                  className="@container relative overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)"
                >
                  {inSale && (
                    <span className="absolute end-1.5 top-1.5 z-10 rounded-full bg-(--brand-500) px-2 py-0.5 text-[11px] font-black tabular-nums text-(--brand-contrast)" dir="ltr">
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
                    <div className="line-clamp-2 break-words text-[13px] font-bold leading-tight">{p.name}</div>
                    {pack ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-(--brand-500)/10 px-2 py-1.5">
                          <span className="min-w-0 break-words text-[9px] font-black uppercase leading-tight opacity-60 @[11rem]:text-[10px]">{pack.unit.name}</span>
                          <span className="shrink-0 whitespace-nowrap text-[13px] font-black tabular-nums @[11rem]:text-[14px] text-(--brand-600)" dir="ltr">{dzMoney(packPrice)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-(--bg-sunken) px-2 py-1.5">
                          <span className="min-w-0 break-words text-[9px] font-black uppercase leading-tight opacity-60 @[11rem]:text-[10px]">{p.baseUnit?.name ?? ""}</span>
                          <span className="shrink-0 whitespace-nowrap text-[13px] font-black tabular-nums @[11rem]:text-[14px]" dir="ltr">{dzMoney(base)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-(--brand-500)/10 px-2 py-1.5">
                        <span className="min-w-0 break-words text-[9px] font-black uppercase leading-tight opacity-60 @[11rem]:text-[10px]">{p.baseUnit?.name ?? ""}</span>
                        <span className="shrink-0 whitespace-nowrap text-[13px] font-black tabular-nums @[11rem]:text-[14px] text-(--brand-600)" dir="ltr">{dzMoney(base)}</span>
                      </div>
                    )}
                    <div className={cn("rounded-lg bg-(--bg-sunken) px-1.5 py-1 text-[9.5px] font-bold tabular-nums @[11rem]:text-[10.5px]", stock < 0 ? "text-red-500" : "")}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0">
                        <span className="min-w-0 break-words opacity-60">{labels.stock}</span>
                        <span className="shrink-0 whitespace-nowrap"><bdi>{pack ? whole : stock}</bdi> {pack ? pack.unit.name : (p.baseUnit?.name ?? "")}</span>
                      </div>
                      {pack && (
                        <>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0 opacity-80">
                            <span className="min-w-0 break-words opacity-60">1 {pack.unit.name} =</span>
                            <span className="shrink-0 whitespace-nowrap"><bdi>{f}</bdi> {p.baseUnit?.name ?? ""}</span>
                          </div>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0 opacity-80">
                            <span className="min-w-0 break-words opacity-60">{labels.total}</span>
                            <span className="shrink-0 whitespace-nowrap"><bdi>{whole * f}</bdi> {p.baseUnit?.name ?? ""}</span>
                          </div>
                        </>
                      )}
                      {held > 0 && (
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0 text-amber-600">
                          <span className="min-w-0 break-words opacity-60">🔒 {labels.held ?? "held"}</span>
                          <span className="shrink-0 whitespace-nowrap"><bdi>{pack ? Math.floor(held / (f || 1)) : held}</bdi> {pack ? pack.unit.name : (p.baseUnit?.name ?? "")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>

      <BottomSheet
        open={showFacture}
        onClose={() => setShowFacture(false)}
        title={labels.facture}
        subtitle={`${lines.length} · ${totalTxt}`}
        testId="facture-sheet"
        footer={
          <>
          <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) px-3 py-2.5">
            <span className="text-sm font-black">{labels.total}</span>
            <span className="text-lg font-black tabular-nums" dir="ltr">{totalTxt}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-bold opacity-70">{labels.paid}</span>
            <Input value={paid} onChange={(e) => { setPaid(e.target.value); setPaidTouched(e.target.value.trim() !== ""); }} inputMode="decimal" placeholder={String(Math.floor(Math.round(total * 100) / 100))} dir="ltr" />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
          <Button onClick={() => void confirmSale()} disabled={saving || !lines.length} data-testid="confirm-sale" className="h-12 w-full text-base">
            {saving ? "…" : `${labels.confirm} · ${totalTxt}`}
          </Button>
          </>
        }
      >
        <div className="space-y-1.5">
            {lines.map((l, i) => {
              const p = effProducts.find((x) => x.id === l.productId) ?? products.find((x) => x.id === l.productId);
              const img = p?.images?.[0]?.url;
              // Full detail of the line: the unit sold, how many pieces it holds,
              // and the price per unit AND per piece.
              const conv = p?.conversions.find((c) => c.unitId === l.unitId);
              const uf = conv ? normFactor(Number(conv.factor)) : 1;
              const baseName = p?.baseUnit?.name ?? "";
              const uName = conv?.unit.name ?? baseName;
              const upr = effLines[i].unitPrice;
              const isPack = uf > 1;
              return (
                <div key={i} className="flex gap-2.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5">
                  {img ? (
                    <button
                      type="button"
                      onClick={() => setZoom({ src: img, name: p?.name ?? "" })}
                      aria-label={p?.name ?? ""}
                      className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-500)"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={p?.name ?? ""} className="h-16 w-16 rounded-xl object-cover" loading="lazy" />
                    </button>
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-xl opacity-50">📦</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 text-[13px] font-bold leading-tight">
                        <span className="line-clamp-2 break-words">{p?.name ?? l.productId.slice(-4)}</span>
                        <span className="mt-0.5 block w-fit max-w-full break-words rounded-full bg-(--bg-sunken) px-1.5 py-px text-[10px] font-black leading-tight opacity-70">
                          {tierName(l.tierId)}
                        </span>
                      </div>
                      <div className="shrink-0 whitespace-nowrap text-sm font-black tabular-nums" dir="ltr">{dzMoney(l.qty * effLines[i].unitPrice)}</div>
                    </div>
                    {/* One compact info strip: pack size once, then price per unit / per piece. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] font-bold leading-tight tabular-nums">
                      {isPack && (
                        <span className="rounded-md bg-(--brand-500)/10 px-1.5 py-0.5 text-(--brand-600)">
                          <bdi>1 {uName}</bdi> = <bdi>{uf} {baseName}</bdi>
                        </span>
                      )}
                      <span className="rounded-md bg-(--bg-sunken) px-1.5 py-0.5">
                        {effLines[i].deal && <span className="me-1 opacity-40 line-through">{dzMoney(l.unitPrice)}</span>}
                        <bdi className="opacity-60">{uName}</bdi> <b className={effLines[i].deal ? "text-amber-700" : undefined}>{dzMoney(upr)}</b>
                      </span>
                      {isPack && (
                        <span className="rounded-md bg-(--bg-sunken) px-1.5 py-0.5">
                          <bdi className="opacity-60">{baseName}</bdi> <b>{dzMoney(upr / uf)}</b>
                        </span>
                      )}
                      <DealChip deal={effLines[i].deal} money={dzMoney(effLines[i].unitPrice)} />
                    </div>
                    {/* Quantity row: pieces total on the start side, big thumb-friendly stepper on the end. */}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] font-bold opacity-60 tabular-nums">
                        {isPack ? <><bdi>{l.qty} {uName}</bdi> = <b><bdi>{Math.round(l.qty * uf * 1000) / 1000} {baseName}</bdi></b></> : <>× <bdi>{l.qty}</bdi></>}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={labels.remove ?? "Remove"}
                          title={labels.remove ?? "Remove"}
                          onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-red-500 active:bg-red-500/15"
                        >
                          <Trash2 size={16} />
                        </button>
                        <div className="flex items-center rounded-xl bg-(--bg-sunken)">
                          <button aria-label="-" onClick={() => bump(i, -1)} className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-black/10">
                            <Minus size={16} />
                          </button>
                          <span className="min-w-8 text-center text-base font-black tabular-nums">{l.qty}</span>
                          <button aria-label="+" onClick={() => bump(i, 1)} className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-black/10">
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {gifts.map((g) => (
              <GiftLineRow
                key={`${g.ruleId}:${g.productId}`}
                gift={g}
                product={giftProducts.find((x) => x.id === g.productId)}
                freeLabel={t3("free")}
                money={dzMoney(0)}
              />
            ))}
            {lines.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
          </div>
      </BottomSheet>

      {/* Cart bar: floats over the screen, always visible (no scrolling to find
          it). Rendered in the app shell via a portal so no page container, zoom
          or stacking context can sit between it and the click. */}
      {mounted && kbInset === 0 && !showFacture && createPortal(
        <div
          className="gw-bottom-bar pointer-events-none bg-gradient-to-t from-(--bg-page) via-(--bg-page)/85 to-transparent px-3 pt-8 print:hidden"
          style={{ position: "fixed", insetInlineEnd: 0, bottom: "var(--bottom-chrome, 0px)", zIndex: 45, paddingBottom: "calc(var(--safe-floor, 0px) + 10px)" }}
        >
          <button
            type="button"
            data-testid="cart-bar"
            onClick={() => setShowFacture(true)}
            className={cn(
              "pointer-events-auto mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl px-3 py-2.5 text-start shadow-[0_10px_28px_-8px_rgba(0,0,0,0.5)] transition-transform active:scale-[0.98]",
              lines.length ? "bg-gradient-brand text-(--brand-contrast)" : "border border-(--border-default) bg-(--bg-overlay)"
            )}
          >
            <span className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", lines.length ? "bg-black/15" : "bg-(--bg-sunken)")}>
              <ShoppingBag size={21} />
              <span key={lines.length} className="gw-bump absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1 text-[11px] font-black tabular-nums text-white">
                {lines.length}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-black uppercase tracking-wide opacity-70">{labels.facture}</span>
              <span className="block truncate text-lg font-black leading-tight tabular-nums" dir="ltr">{dzMoney(total)}</span>
            </span>
            <ChevronUp size={22} className="shrink-0" />
          </button>
        </div>,
        document.querySelector("[data-shell-content]")?.parentElement ?? document.body
      )}

      {/* Scan popup — locked: no ✕, no skip, no manual pick. The sale
          cannot start until the client QR is scanned (camera or gallery). */}
      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title={labels.scanTitle} subtitle={vanName} icon={<QrCode size={18} />} locked={qrStrict}>
        <div className="space-y-3">
          <CameraBox
            hint={labels.scanHint}
            onDetect={(t) => { void onScan(t); }}
            labels={{
              scan: labels.scan ?? labels.scanTitle,
              gallery: labels.gallery ?? "gallery",
              qrNotFound: labels.qrNotFound ?? "qr_not_found",
              camNeedHttps: labels.camNeedHttps ?? "",
              camDenied: labels.camDenied ?? "",
              camUnsupported: labels.camUnsupported ?? "",
            }}
          />
          {scanError && <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500">{scanError}</p>}
          {!qrStrict && (
            <div className="space-y-2 rounded-2xl border border-(--border-default) p-2.5">
              <div className="text-xs font-black opacity-70">{labels.chooseClient}</div>
              <Input value={clientQ} onChange={(e) => setClientQ(e.target.value)} placeholder={labels.searchClient} />
              {clientHits.length > 0 && (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {clientHits.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => { setClient(c); setScanned(false); setScanError(null); setScanOpen(false); setClientQ(""); }}
                        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2 text-start text-sm font-bold hover:bg-(--brand-500)/10"
                      >
                        <span className="min-w-0 truncate">{c.name}</span>
                        <span className="shrink-0 font-mono text-[11px] opacity-60" dir="ltr">{c.code}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="secondary" onClick={() => setScanOpen(false)} className="w-full">
                {labels.skip}
              </Button>
            </div>
          )}
          <Button variant="secondary" onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)} className="w-full">
            <ArrowLeft size={15} className="me-1 rtl:rotate-180" />
            {labels.backToDash ?? labels.backToProducts}
          </Button>
        </div>
      </Modal>

      {/* Qty popup — centered, with van stock cap */}
      {qtyFor && (() => {
        const pack = packOf(qtyFor);
        const base = priceFor(qtyFor, selTier);
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
            <div className="relative max-h-[calc(var(--vh)*0.9)] w-full max-w-sm overflow-y-auto rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-2xl">
              <div className="mb-1 truncate text-base font-black">{qtyFor.name}</div>
              <div className={cn("mb-2 rounded-xl bg-(--bg-sunken) p-2.5", live < 0 ? "text-red-500" : "")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold opacity-60">{labels.stock}</span>
                  <span className="text-base font-black tabular-nums"><bdi>{pack ? packs : Math.floor(avail)}</bdi> {pack ? pack.unit.name : (qtyFor.baseUnit?.name ?? "")}{pack && rest > 0 ? <> + <bdi>{rest}</bdi> {qtyFor.baseUnit?.name ?? ""}</> : null}</span>
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
                <Button onClick={addQty} disabled={qtyPacks <= 0 && qtyUnits <= 0} data-testid="qty-confirm" className="flex-[2]">{labels.confirm}</Button>
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
            <img src={gallery.images[gIdx]?.url} alt={gallery.name} className="max-h-[calc(var(--vh)*0.6)] w-full rounded-xl object-contain" />
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

      {/* Done → print preview popup. Always the full facture — online with
          the server number, offline from the local snapshot (number comes
          at sync). doneQueued only adds the queued banner on top. Rendered
          in a body-level portal so the print CSS can isolate the ticket. */}
      {doneId !== null && !doneTicket && (
        <Modal open onClose={closeDone} title={labels.saved} subtitle="" icon={<Check size={18} />}>
          <p className="text-xs font-bold opacity-60">{labels.ticketQueued ?? labels.printHint}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={closeDone} className="flex-1">{labels.cancel}</Button>
          </div>
        </Modal>
      )}
      {doneId !== null && doneTicket && typeof document !== "undefined" && createPortal(
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
                <Button variant="secondary" onClick={() => setPdfView(true)} data-testid="pv-share" className="flex-1">
                  <Share2 size={16} className="me-1" />
                  {ticketLabels.share}
                </Button>
                <Button onClick={doPrint} data-testid="pv-print" className="flex-[2]">
                  <Printer size={16} className="me-1" />
                  {labels.print}
                </Button>
              </div>
              {pdfView && doneTicket && (
                <PdfViewer
                  ticket={doneTicket}
                  company={{ name: ticketCo?.company.name ?? "", phone: ticketCo?.company.phone ?? null, address: ticketCo?.company.address ?? null, rc: ticketCo?.company.rc ?? null, nif: ticketCo?.company.nif ?? null, nis: ticketCo?.company.nis ?? null, logoUrl: ticketCo?.company.logoUrl ?? null }}
                  lang={ticketLang}
                  labels={ticketLabels}
                  qrDataUrl={ticketQr}
                  onClose={() => setPdfView(false)}
                />
              )}
              {sharedMsg && (
                <div className="no-print mx-auto max-w-full pb-8 text-center text-xs font-bold text-white/90" style={{ width: `${ticketCo?.width ?? "80"}mm` }}>
                  {sharedMsg}
                </div>
              )}
              {doneQueued && (
                <div className="no-print mx-auto max-w-full pb-8 text-center text-xs font-bold text-white/90" style={{ width: `${ticketCo?.width ?? "80"}mm` }}>
                  {labels.ticketQueued ?? labels.printHint}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.name} caption={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  );
}
