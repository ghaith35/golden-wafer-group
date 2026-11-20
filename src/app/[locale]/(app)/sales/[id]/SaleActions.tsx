"use client";

import { useEffect, useState } from "react";
import { FREE_LABEL } from "@/lib/threepack/labels";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Truck, Bus, CalendarClock, Check, CircleDollarSign, Layers, Package, Printer, Store, Wallet, Coins } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BonRouteFlow } from "@/components/sales/BonRouteFlow";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { SaleDocForm } from "../SaleDocForm";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PackInfo, factorOf, normFactor, LinePriceSummary } from "@/components/products/UnitQty";
import { dz, dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
export type SaleDetail = {
  id: string;
  kind: string;
  status: string;
  channel: string;
  number: string;
  total: unknown;
  paid: unknown;
  remise: unknown;
  locationId: string | null;
  tierId: string | null;
  notes: string | null;
  date?: string | null;
  client: { id: string; name: string; code: string; gpsLat?: number | null; gpsLng?: number | null; rc?: string | null; ai?: string | null; nif?: string | null; nis?: string | null; rib?: string | null } | null;
  location: { id: string; name: string; kind?: string } | null;
  /// Silent sale-site check (admin eyes only — never shown to the driver).
  saleLat?: number | null;
  saleLng?: number | null;
  saleDistM?: number | null;
  lines: Array<{
    id: string;
    productId: string;
    qty: unknown;
    baseQty: unknown;
    unitId: string | null;
    unitPrice: unknown;
    remise: unknown;
    lineTotal: unknown;
    /// 3pack gift line (price 0).
    isBonus?: boolean;
    product: {
      name: string;
      reference: string | null;
      colisage?: string | null;
      baseUnitId: string | null;
      baseUnit: { name: string } | null;
      images: Array<{ url: string }>;
      conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { name: string } }>;
    };
  }>;
  children: Array<{ id: string; number: string; kind: string; status: string }>;
};

const num = (v: number) => dzMoney(v);

const STATUS_PILL: Record<string, string> = {
  DRAFT: "bg-(--bg-sunken) text-(--text-secondary)",
  CONFIRMED: "bg-sky-500/15 text-sky-600",
  DELIVERED: "bg-emerald-500/15 text-emerald-600",
  INVOICED: "bg-(--brand-500)/15 text-(--gold-text)",
  CANCELLED: "bg-red-500/15 text-red-500",
};

function MoneyTile({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string; tone: "gold" | "green" | "red" }) {
  const t = tone === "gold" ? "bg-(--brand-500)/12 text-(--gold-text)" : tone === "green" ? "bg-emerald-500/12 text-(--semantic-success)" : "bg-red-500/12 text-(--semantic-danger)";
  return (
    <div className={cn("min-w-0 rounded-2xl p-2.5 sm:p-3", t)}>
      <div className="flex items-center gap-1.5 text-[10.5px] font-black opacity-80"><Icon size={13} /><span className="truncate">{label}</span></div>
      <div className="mt-1 truncate text-[clamp(13px,1.5vw,19px)] font-black tabular-nums" dir="ltr">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: "teal" | "gold" | "rose" }) {
  return (
    <div className={cn(
      "min-w-16 rounded-xl px-2 py-1.5",
      tone === "teal" ? "bg-emerald-500/10" : tone === "gold" ? "bg-amber-500/10" : "bg-red-500/10"
    )}>
      <div className="text-[9px] font-black uppercase tracking-wide opacity-60">{label}</div>
      <div className={cn(
        "truncate text-sm font-black tabular-nums",
        tone === "teal" ? "text-emerald-600" : tone === "gold" ? "text-amber-600" : "text-red-500"
      )}>
        {value}
      </div>
    </div>
  );
}

/// Silent sale-site check (admin eyes only — the driver never sees this):
/// where the phone was at sale time vs the client's registered position.
/// Renders nothing when there is no fix (denied/unavailable/legacy sale).
/// 500m+ reads as "away from the client".
function SiteCheckCard({ sale, labels }: { sale: SaleDetail; labels: Record<string, string> }) {
  const lat = sale.saleLat;
  const lng = sale.saleLng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const dist = typeof sale.saleDistM === "number" && Number.isFinite(sale.saleDistM) ? sale.saleDistM : null;
  const away = dist != null && dist >= 500;
  const fmtDist = dist == null ? "—" : dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`;
  const saleUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const clat = sale.client?.gpsLat;
  const clng = sale.client?.gpsLng;
  const clientUrl = typeof clat === "number" && typeof clng === "number" && Number.isFinite(clat) && Number.isFinite(clng)
    ? `https://www.google.com/maps?q=${clat},${clng}`
    : null;
  return (
    <div className={cn(
      "rounded-2xl border p-3",
      away ? "border-red-500/40 bg-red-500/5" : "border-(--border-default) bg-(--bg-overlay)"
    )}>
      <div className="flex items-center gap-2">
        <span className="text-base">📍</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black">
            {labels.siteCheck ?? "Sale site"}
            {dist != null && (
              <span className={cn(
                "ms-2 rounded-full px-2 py-0.5 text-[10px] tabular-nums",
                away ? "bg-red-500/15 text-red-500" : "bg-emerald-500/15 text-emerald-600"
              )} dir="ltr">
                {fmtDist}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-bold opacity-70">
            <a href={saleUrl} target="_blank" rel="noreferrer" className="underline" dir="ltr">
              {labels.siteSale ?? "sale"} 📍
            </a>
            {clientUrl && (
              <a href={clientUrl} target="_blank" rel="noreferrer" className="underline" dir="ltr">
                {labels.siteClient ?? "client"} 📍
              </a>
            )}
          </div>
        </div>
        {away && (
          <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-1 text-[10px] font-black text-red-500">
            ⚠ {labels.awayFromClient ?? ""}
          </span>
        )}
      </div>
    </div>
  );
}
export function SaleActions({
  locale,
  sale,
  locations,
  labels,
  onDone,
  formData,
  formLabels,
  canEdit = false,
}: {
  locale: string;
  sale: SaleDetail;
  locations: Array<{ id: string; name: string; kind?: string; noStock?: boolean }>;
  labels: Record<string, string>;
  /// Master-detail mode: refresh inline instead of navigating.
  onDone?: (newId?: string) => void;
  /// Facture edit (Admin): full editor reference data + labels. When absent
  /// the تعديل button stays hidden.
  formData?: {
    clients: Array<{ id: string; name: string; code: string; tierId: string | null; balance: unknown }>;
    products: Array<{
      id: string; name: string; salePrice: number; colisage?: string | null; barcode?: string | null;
      baseUnitId: string | null; baseUnit: { id: string; name: string } | null; saleUnitId: string | null;
      conversions: Array<{ unitId: string; factor: number; barcode?: string | null; unit: { id: string; name: string } }>;
      tierPrices: Array<{ tierId: string; price: number }>;
    }>;
    units: Array<{ id: string; name: string }>;
    tiers: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string; kind: string }>;
    settings: { remiseEnabled: boolean; creditSalesEnabled: boolean; pieceSalesEnabled: boolean };
  } | null;
  formLabels?: Record<string, string> | null;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(sale.locationId ?? "");
  const [assignTo, setAssignTo] = useState(sale.locationId ?? "");
  const [extraPaid, setExtraPaid] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Popup form replacing the old JS confirm(): which action awaits approval.
  const [modal, setModal] = useState<null | "load" | "assign" | "deliver" | "invoice" | "cancel" | "uncancel" | "deleteOrder" | "facture">(null);
  const [editing, setEditing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(d?.user?.role === "Admin"))
      .catch(() => setIsAdmin(false));
  }, []);
  const [blOpen, setBlOpen] = useState(false);
  const [bdrOpen, setBdrOpen] = useState(false);
  const [bcOpen, setBcOpen] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  /// Depot availability for the load preview (fetched when opening it).
  const [depotMap, setDepotMap] = useState<Record<string, number> | null>(null);

  function openLoad() {
    setAssignTo(sale.locationId ?? "");
    setDepotMap(null);
    setModal("load");
    fetch("/api/stock/depot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d === "object") setDepotMap(d); })
      .catch(() => {});
  }

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/${sale.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "failed");
        return;
      }
      if (data.id && (action === "deliver" || action === "invoice")) {
        if (onDone) onDone(data.id);
        else router.push(`/${locale}/sales/${data.id}`);
      } else {
        if (onDone) onDone();
        else router.refresh();
      }
      setModal(null);
    } finally {
      setBusy(false);
    }
  }

  const total = Number(sale.total);
  const paid = Number(sale.paid ?? 0);
  const due = total - paid;
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : paid > 0 ? 100 : 0;
  const kindName = ({ TICKET: labels.kindTicket, DELIVERY: labels.kindDelivery, INVOICE: labels.kindInvoice, ORDER: labels.kindOrder } as Record<string, string | undefined>)[sale.kind] ?? sale.kind;
  const statusName = labels[sale.status.toLowerCase()] ?? sale.status;
  const when = sale.date ? new Date(sale.date) : null;
  const dloc = `${locale === "ar" ? "ar-DZ" : locale}-u-nu-latn`;

  const viewLine = (l: SaleDetail["lines"][number]) => {
    const p = l.product;
    const lineTotal = Number(l.lineTotal);
    if (!p) return { hasProduct: false as const, name: "—", img: null as string | null, ref: "", qty: Number(l.qty), uname: "", remise: 0, lineTotal, piecePrice: 0, packPrice: 0, packName: "", packF: 0, packQty: 0, base: 0, baseName: "" };
    const convs = p.conversions ?? [];
    const imgs = p.images ?? [];
    const f = factorOf({ ...p, conversions: convs }, l.unitId ?? "");
    const firstPack = convs.filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
    let uname = !l.unitId || l.unitId === p.baseUnitId ? (p.baseUnit?.name ?? "") : (convs.find((c) => c.unitId === l.unitId)?.unit.name ?? "");
    if (!uname) uname = firstPack?.unit.name ?? p.baseUnit?.name ?? "";
    const unitPrice = Number(l.unitPrice);
    const nf = normFactor(f);
    const base = Number(l.baseQty ?? l.qty);
    const packF = firstPack ? normFactor(Number(firstPack.factor)) : 0;
    const packName = f > 1 ? uname : (firstPack?.unit.name ?? "");
    return {
      hasProduct: true as const,
      name: p.name,
      img: imgs[0]?.url ?? null,
      ref: p.reference ?? "",
      qty: Number(l.qty),
      uname,
      remise: Number(l.remise),
      lineTotal,
      piecePrice: f > 1 ? unitPrice / nf : unitPrice,
      packPrice: f > 1 ? unitPrice : packF > 0 ? unitPrice * packF : 0,
      packName,
      packF,
      packQty: packF > 0 ? Math.round((base / packF) * 100) / 100 : 0,
      base,
      baseName: p.baseUnit?.name ?? "",
    };
  };
  const piecesTotal = (sale.lines ?? []).reduce((s2, l) => s2 + Number(l.baseQty ?? l.qty ?? 0), 0);

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      {/* ── Invoice hero: identity, status, money trio, payment progress ── */}
      <div className="relative overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
        <div className="h-1 bg-gradient-brand" />
        <span aria-hidden className="pointer-events-none absolute -end-16 -top-16 h-44 w-44 rounded-full bg-(--brand-500) opacity-10 blur-3xl" />
        <div className="relative space-y-4 p-4">
          <div className="flex items-start gap-3">
            <Avatar name={sale.client?.name ?? labels.walkin} size="lg" walkin={!sale.client} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-lg bg-(--brand-500)/12 px-2 py-0.5 text-[11px] font-black text-(--gold-text)">{kindName}</span>
                <span className="rounded-lg bg-(--bg-sunken) px-2 py-0.5 font-mono text-[11px] font-black text-(--text-secondary)" dir="ltr">{sale.number}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black", STATUS_PILL[sale.status] ?? STATUS_PILL.DRAFT)}>{statusName}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 [&_button]:min-h-9 [&_button]:rounded-lg [&_button]:px-3 [&_button]:py-1 [&_button]:text-xs [&_button]:font-black">
                {sale.kind === "ORDER" && sale.status === "DRAFT" && (
                  <Button onClick={openLoad} disabled={busy} className="flex-1">📦 {labels.confirmLoad ?? labels.confirm}</Button>
                )}
                {sale.kind === "ORDER" && (sale.status === "DRAFT" || sale.status === "CONFIRMED") && (
                  <Button variant="secondary" onClick={() => { setAssignTo(sale.locationId ?? ""); setModal("assign"); }} disabled={busy} className="flex-1">
                    🚚 {sale.location ? sale.location.name : labels.assign}
                  </Button>
                )}
                {sale.kind === "ORDER" && sale.status === "CONFIRMED" && (
                  <Button onClick={() => { setLocationId(sale.locationId ?? ""); setExtraPaid(0); setModal("deliver"); }} disabled={busy} className="flex-1">
                    {labels.deliver}
                  </Button>
                )}
                {sale.kind === "DELIVERY" && sale.status === "DELIVERED" && (
                  <Button onClick={() => setModal("invoice")} disabled={busy}>{labels.invoice}</Button>
                )}
                {((sale.kind === "TICKET" || sale.kind === "DELIVERY") && sale.status === "DELIVERED") && (
                  <Button variant="secondary" onClick={() => setModal("cancel")} disabled={busy} className="text-red-500">{labels.cancelT ?? labels.cancel}</Button>
                )}
                {sale.kind === "DELIVERY" && sale.status === "CANCELLED" && (
                  <Button onClick={() => setModal("uncancel")} disabled={busy}>{labels.redeliverT ?? labels.deliver}</Button>
                )}
                {sale.kind === "ORDER" && (sale.status === "DRAFT" || sale.status === "CONFIRMED") && canEdit && isAdmin && formData && formLabels && (
                  <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                    ✎ {labels.edit ?? "Edit"}
                  </Button>
                )}
                {sale.kind === "ORDER" && sale.status !== "DELIVERED" && sale.status !== "INVOICED" && sale.children.length === 0 && canEdit && isAdmin && (
                  <Button variant="secondary" onClick={() => setModal("deleteOrder")} disabled={busy} className="text-red-500">
                    {labels.deleteOrderT ?? "Delete"}
                  </Button>
                )}
                {sale.kind === "TICKET" && sale.status !== "CANCELLED" && canEdit && isAdmin && formData && formLabels && (
                  <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                    ✎ {labels.edit ?? "Edit"}
                  </Button>
                )}
                {sale.kind === "INVOICE" && (
                  <Link href={`/${locale}/sales/${sale.id}/print`}>
                    <Button variant="secondary">{labels.print} FAC</Button>
                  </Link>
                )}
                {sale.kind === "TICKET" && (
                  <Link href={`/${locale}/sales/${sale.id}/ticket`}>
                    <Button variant="secondary">{labels.print} ticket</Button>
                  </Link>
                )}
                {sale.kind === "ORDER" && (sale.status === "CONFIRMED" || sale.status === "DELIVERED" || sale.status === "INVOICED") && (
                  <Button onClick={() => setBcOpen(true)} className="gap-1.5">
                    <Printer size={14} />{labels.printOrder ?? "Print order"}
                  </Button>
                )}
                {sale.kind !== "ORDER" && (
                  <Button onClick={() => setModal("facture")} className="gap-1.5">
                    <FileText size={14} />{labels.factureBtn ?? "Facture"}
                  </Button>
                )}
              </div>
              <div className="mt-1.5 truncate text-lg font-black leading-tight sm:text-xl">{sale.client ? sale.client.name : labels.walkin}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-bold text-(--text-secondary)">
                {sale.client && <span className="font-mono" dir="ltr">{sale.client.code}</span>}
                {sale.location && (
                  <span className="flex items-center gap-1">
                    {sale.location.kind === "VAN" ? <Bus size={12} /> : <Store size={12} />}
                    {sale.location.name}
                  </span>
                )}
                {when && (
                  <span className="flex items-center gap-1" dir="auto">
                    <CalendarClock size={12} />
                    {when.toLocaleDateString(dloc, { day: "numeric", month: "short", year: "numeric" })} · {when.toLocaleTimeString(dloc, { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                )}
                <span className="flex items-center gap-1"><Layers size={12} />{sale.lines?.length ?? 0} {labels.linesCount ?? ""}</span>
              </div>
            </div>
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                due <= 0.005 ? "bg-emerald-500/15 text-(--semantic-success)" : "bg-red-500/15 text-(--semantic-danger)"
              )}
              title={due <= 0.005 ? labels.paid : labels.due}
            >
              {due <= 0.005 ? <Check size={20} strokeWidth={3} /> : <CircleDollarSign size={20} />}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <MoneyTile icon={Coins} label={labels.total} value={num(total)} tone="gold" />
            <MoneyTile icon={Wallet} label={labels.paid} value={num(paid)} tone="green" />
            <MoneyTile icon={CircleDollarSign} label={labels.due} value={num(Math.max(0, due))} tone={due > 0.005 ? "red" : "green"} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[10.5px] font-black text-(--text-tertiary)">
              <span>{labels.progressPaid ?? ""}</span>
              <span className="tabular-nums" dir="ltr">{pct}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-(--bg-sunken)">
              <div
                className={cn("gw-grow-x h-full rounded-full", pct >= 100 ? "bg-gradient-to-r from-emerald-600 to-emerald-300" : pct > 0 ? "bg-gradient-to-r from-amber-600 to-amber-300" : "bg-(--border-default)")}
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      <SiteCheckCard sale={sale} labels={labels} />
      <div className="overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
        <div className="flex items-center justify-between gap-3 border-b border-(--border-default) bg-[linear-gradient(180deg,var(--gold-wash),transparent)] px-4 py-3">
          <span className="flex items-center gap-2 text-[12px] font-black text-(--text-secondary)">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-(--gold-wash) text-(--gold-text)"><Package size={15} /></span>
            {sale.lines?.length ?? 0} {labels.linesCount ?? ""}
            <span className="text-(--text-tertiary)">·</span>
            <span className="tabular-nums" dir="ltr">{dz(piecesTotal)} {labels.pieces ?? ""}</span>
          </span>
          <span className="text-lg font-black tabular-nums" dir="ltr">{num(total)}</span>
        </div>

        {/* phones: one card per line */}
        <ul className="divide-y divide-(--border-subtle) md:hidden">
          {(sale.lines ?? []).map((l) => {
            const v = viewLine(l);
            return (
              <li key={l.id} className="p-3">
                <div className="flex items-start gap-2.5">
                  {v.img ? (
                    <button type="button" onClick={() => setZoom({ src: v.img!, name: v.name })} aria-label={v.name} className="shrink-0 rounded-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.img} alt={v.name} className="h-12 w-12 rounded-xl object-cover" loading="lazy" />
                    </button>
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-lg opacity-60">📦</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-[13px] font-black leading-snug">{v.name}{l.isBonus && <span className="ms-1.5 rounded-full bg-emerald-600 px-1.5 py-px text-[9px] font-black uppercase text-white">★ {FREE_LABEL[locale === "fr" || locale === "en" ? locale : "ar"]}</span>}</span>
                      <span className="shrink-0 text-[13px] font-black tabular-nums" dir="ltr">{dzMoney(v.lineTotal)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                      <span className="rounded-md bg-(--brand-500)/12 px-1.5 py-0.5 font-black tabular-nums text-(--gold-text)" dir="ltr">×{v.qty} {v.uname}</span>
                      {v.ref && <span className="font-mono text-(--text-tertiary)" dir="ltr">{v.ref}</span>}
                      {v.remise > 0 && <span className="text-(--semantic-danger)" dir="ltr">− {dzMoney(v.remise)}</span>}
                    </div>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[11px] font-bold">
                  <div className="rounded-lg bg-(--bg-sunken) px-2.5 py-1.5"><div className="text-[9.5px] text-(--text-tertiary)">{labels.unitPriceL} · {v.baseName}</div><div className="tabular-nums" dir="ltr">{dzMoney(v.piecePrice)}</div></div>
                  <div className="rounded-lg bg-(--bg-sunken) px-2.5 py-1.5"><div className="text-[9.5px] text-(--text-tertiary)">{labels.packPriceL}{v.packName ? ` · ${v.packName}` : ""}</div><div className="tabular-nums text-(--gold-text)" dir="ltr">{v.packName ? dzMoney(v.packPrice) : "—"}</div></div>
                  <div className="rounded-lg bg-(--bg-sunken) px-2.5 py-1.5"><div className="text-[9.5px] text-(--text-tertiary)">{labels.qtyPack}</div><div className="tabular-nums" dir="ltr">{v.packF > 0 ? dz(v.packQty) : "—"}</div></div>
                  <div className="rounded-lg bg-(--bg-sunken) px-2.5 py-1.5"><div className="text-[9.5px] text-(--text-tertiary)">{labels.qtyPiece} · {v.baseName}</div><div className="tabular-nums" dir="ltr">{dz(v.base)}</div></div>
                </div>
                {v.packF > 0 && <div className="mt-1.5 text-[10px] font-bold text-(--gold-text)"><bdi>1 {v.packName} = {dz(v.packF)} {v.baseName}</bdi></div>}
              </li>
            );
          })}
        </ul>

        {/* ≥ md: dense table */}
        <div className="table-shell hidden !rounded-none !border-0 !shadow-none md:block">
          <table className="min-w-[640px]">
            <thead>
              <tr>
                <th>{labels.product}</th>
                <th className="num">{labels.unitPriceL}</th>
                <th className="num">{labels.packPriceL}</th>
                <th className="num">{labels.qtyPack}</th>
                <th className="num">{labels.qtyPiece}</th>
                <th className="num">{labels.total}</th>
              </tr>
            </thead>
            <tbody>
              {(sale.lines ?? []).map((l) => {
                const v = viewLine(l);
                if (!v.hasProduct) {
                  return (
                    <tr key={l.id}>
                      <td className="opacity-60">—</td>
                      <td colSpan={4} />
                      <td className="num font-black" dir="ltr">{dzMoney(v.lineTotal)}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={l.id} className="align-top">
                    <td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        {v.img ? (
                          <button type="button" onClick={() => setZoom({ src: v.img!, name: v.name })} aria-label={v.name} className="shrink-0 rounded-lg">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={v.img} alt={v.name} className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
                          </button>
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-base opacity-60">📦</div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-black">{v.name}{l.isBonus && <span className="ms-1.5 rounded-full bg-emerald-600 px-1.5 py-px text-[9px] font-black uppercase text-white">★ {FREE_LABEL[locale === "fr" || locale === "en" ? locale : "ar"]}</span>}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] font-bold text-(--text-tertiary)">
                            <span className="rounded-md bg-(--brand-500)/12 px-1.5 py-0.5 font-black tabular-nums text-(--gold-text)" dir="ltr">×{v.qty} {v.uname}</span>
                            {v.ref && <span className="truncate font-mono" dir="ltr">{v.ref}</span>}
                            {v.remise > 0 && <span className="text-(--semantic-danger)" dir="ltr">− {dzMoney(v.remise)}</span>}
                          </div>
                          {v.packF > 0 && <div className="mt-0.5 truncate text-[10px] font-bold text-(--gold-text)"><bdi>1 {v.packName} = {dz(v.packF)} {v.baseName}</bdi></div>}
                        </div>
                      </div>
                    </td>
                    <td className="num" dir="ltr"><div className="text-[13px] font-bold">{dzMoney(v.piecePrice)}</div><div className="truncate text-[10px] text-(--text-tertiary)">{v.baseName}</div></td>
                    <td className="num" dir="ltr">
                      {v.packName ? (<><div className="text-[13px] font-bold text-(--gold-text)">{dzMoney(v.packPrice)}</div><div className="truncate text-[10px] text-(--text-tertiary)">{v.packName}</div></>) : <span className="opacity-30">—</span>}
                    </td>
                    <td className="num font-bold" dir="ltr">{v.packF > 0 ? dz(v.packQty) : <span className="opacity-30">—</span>}</td>
                    <td className="num" dir="ltr"><div className="text-[13px] font-bold">{dz(v.base)}</div><div className="truncate text-[10px] text-(--text-tertiary)">{v.baseName}</div></td>
                    <td className="num text-[13px] font-black" dir="ltr">{dzMoney(v.lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {Number(sale.remise) > 0 && (
          <div className="flex items-center justify-between border-t border-(--border-default) px-4 py-2 text-[12px] font-black text-(--text-secondary)">
            <span>{labels.discount ?? ""}</span>
            <span className="tabular-nums text-(--semantic-danger)" dir="ltr">− {dzMoney(Number(sale.remise))}</span>
          </div>
        )}
      </div>
      {(sale.children ?? []).length > 0 && (
        <Card>
          {(sale.children ?? []).map((c) => (
            onDone ? (
              <button key={c.id} onClick={() => onDone(c.id)} className="block py-1 text-sm font-bold text-(--brand-600)">
                {c.kind} {c.number} · {c.status}
              </button>
            ) : (
              <Link key={c.id} href={`/${locale}/sales/${c.id}`} className="block py-1 text-sm font-bold text-(--brand-600)">
                {c.kind} {c.number} · {c.status}
              </Link>
            )
          ))}
        </Card>
      )}

      {/* ── Popup forms (no more JS confirm) ── */}
      <Modal open={modal === "load"} onClose={() => setModal(null)} title={labels.confirmLoadT ?? labels.confirmLoad ?? labels.confirm} icon="📦" width="sm">
        <div className="space-y-3">
          <div className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
            {sale.number} · {sale.client?.name ?? ""} · {num(total)}
          </div>
          <p className="text-xs font-bold opacity-60">{labels.confirmLoadM ?? ""}</p>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.van ?? labels.location}</label>
            <select
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
            >
              <option value="">—</option>
              {locations.filter((l) => l.kind === "VAN" && !l.noStock).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            {(sale.lines ?? []).map((l) => {
              const p = l.product;
              if (!p) return null;
              const firstPack = (p.conversions ?? []).filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
              const packF = firstPack ? normFactor(Number(firstPack.factor)) : 0;
              const need = Number(l.baseQty ?? l.qty);
              const depotQty = depotMap?.[l.productId] ?? null;
              const short = depotQty != null && depotQty + 1e-9 < need;
              return (
                <div key={l.id} className={cn("flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs tabular-nums", short ? "bg-red-500/10 text-red-500" : "bg-(--bg-sunken)")}>
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {short && "⚠ "}{p.name} · <bdi>{packF > 0 ? `${dz(Math.round((need / packF) * 100) / 100)} ${firstPack!.unit.name}` : `${dz(need)}`}</bdi>
                    {short && depotQty != null && <span className="ms-1 rounded-full bg-red-500/20 px-1.5 text-[10px] font-black">− <bdi>{packF > 0 ? dz(Math.round(((need - depotQty) / packF) * 100) / 100) : dz(need - depotQty)}</bdi></span>}
                  </span>
                  <span className="shrink-0 font-black">
                    🏭 {depotQty == null ? "…" : (<><bdi>{packF > 0 ? dz(Math.round((depotQty / packF) * 100) / 100) : dz(depotQty)}</bdi> {packF > 0 ? firstPack!.unit.name : (p.baseUnit?.name ?? "")}</>)}
                  </span>
                </div>
              );
            })}
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal(null)} className="flex-1">{labels.cancel}</Button>
            <Button
              onClick={() => void act("confirm-load", { locationId: assignTo })}
              disabled={busy || !assignTo || (sale.lines ?? []).some((l) => depotMap != null && (depotMap[l.productId] ?? 0) + 1e-9 < Number(l.baseQty ?? l.qty))}
              className="flex-[2]"
            >
              {busy ? "…" : (labels.confirmLoad ?? labels.confirm)}
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={modal === "cancel"}
        onClose={() => setModal(null)}
        onConfirm={() => act("cancel")}
        title={labels.cancelT ?? labels.cancel}
        message={`${labels.cancelM ?? ""}\n${sale.number} · ${num(total)}`}
        confirmLabel={labels.cancelT ?? labels.cancel}
      />
      <ConfirmDialog
        open={modal === "uncancel"}
        onClose={() => setModal(null)}
        onConfirm={() => act("uncancel")}
        title={labels.redeliverT ?? labels.deliver}
        message={`${labels.redeliverM ?? ""}\n${sale.number} · ${num(total)}`}
        confirmLabel={labels.redeliverT ?? labels.deliver}
      />
      <ConfirmDialog
        open={modal === "invoice"}
        onClose={() => setModal(null)}
        onConfirm={() => act("invoice")}
        title={labels.invoiceT ?? labels.invoice}
        message={`${labels.invoiceM ?? ""}\n${sale.number} · ${num(total)}`}
        confirmLabel={labels.invoice}
      />
      <BonRouteFlow open={bdrOpen} onClose={() => setBdrOpen(false)} locale={locale} saleId={sale.id} saleNumber={sale.number} client={sale.client ? { code: sale.client.code, name: sale.client.name, ids: { rc: sale.client.rc ?? "", art: sale.client.ai ?? "", nif: sale.client.nif ?? "", nis: sale.client.nis ?? "", rib: sale.client.rib ?? "" } } : null} />
      <Modal open={bcOpen} onClose={() => setBcOpen(false)} title={labels.printOrder ?? "Print order"} subtitle={sale.number} icon="📋" width="2xl">
        {bcOpen && (
          <iframe src={`/${locale}/sales/${sale.id}/bc?embed=1`} title="Bon de commande" className="h-[min(78vh,900px)] w-full rounded-xl border border-(--border-default) bg-neutral-200" />
        )}
      </Modal>
      <Modal open={blOpen} onClose={() => setBlOpen(false)} title={labels.bonLivraison ?? "Bon de livraison"} subtitle={sale.number} icon="🧾" width="2xl">
        {blOpen && (
          <iframe
            src={`/${locale}/sales/${sale.id}/bl?embed=1`}
            title="Bon de livraison"
            className="h-[min(78vh,900px)] w-full rounded-xl border border-(--border-default) bg-neutral-200"
          />
        )}
      </Modal>
      <Modal open={modal === "facture"} onClose={() => setModal(null)} title={labels.factureBtn ?? "Facture"} subtitle={`${sale.number}`} icon="🧾" width="md">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => { setModal(null); setBlOpen(true); }}
            className="group relative flex min-h-0 flex-col items-start gap-2 overflow-hidden rounded-2xl border border-(--brand-500) bg-[linear-gradient(135deg,var(--gold-wash),var(--bg-overlay))] p-4 text-start transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-16px_var(--brand-500)]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-brand text-(--brand-contrast)"><FileText size={20} /></span>
            <span className="text-base font-black">{labels.bonLivraison ?? "Bon de livraison"}</span>
            <span className="text-xs font-bold text-(--text-secondary)">{labels.bonLivraisonDesc ?? "A4"}</span>
          </button>
          <button
            type="button"
            onClick={() => { setModal(null); setBdrOpen(true); }}
            className="group relative flex min-h-0 flex-col items-start gap-2 overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 text-start transition-all hover:-translate-y-0.5 hover:border-(--brand-500) hover:shadow-[0_16px_34px_-16px_var(--brand-500)]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-(--gold-wash) text-(--gold-text)"><Truck size={20} /></span>
            <span className="text-base font-black">{labels.bonRoute ?? "Bon de route"}</span>
            <span className="text-xs font-bold text-(--text-secondary)">{labels.bonRouteDesc ?? ""}</span>
          </button>
        </div>
      </Modal>
      <Modal open={modal === "assign"} onClose={() => setModal(null)} title={labels.assignT ?? labels.assign} icon="🚚" width="sm">
        <div className="space-y-3">
          <div className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
            {sale.number} · {sale.client?.name ?? ""} · {num(total)}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.van ?? labels.location}</label>
            <select
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
            >
              <option value="">—</option>
              {locations.filter((l) => l.kind === "VAN").map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal(null)} className="flex-1">{labels.cancel}</Button>
            <Button
              onClick={() => void act("assign", { locationId: assignTo })}
              disabled={busy || !assignTo || assignTo === sale.locationId}
              className="flex-[2]"
            >
              {busy ? "…" : (labels.assignT ?? labels.assign)}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={modal === "deliver"} onClose={() => setModal(null)} title={labels.deliverT ?? labels.deliver} icon="📦" width="sm">
        <div className="space-y-3">
          <div className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
            {sale.number} · {sale.client?.name ?? ""} · {num(total)}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.location}</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
            >
              <option value="">—</option>
              {locations.filter((l) => !l.noStock).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.paid}</label>
            <Input
              type="number" min={0} step="any" value={extraPaid}
              onChange={(e) => setExtraPaid(Number(e.target.value))} dir="ltr"
            />
            <div className="mt-1 text-xs font-bold opacity-60">
              {labels.due}: {num(Math.max(0, total - paid - (Number(extraPaid) || 0)))}
            </div>
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal(null)} className="flex-1">{labels.cancel}</Button>
            <Button
              onClick={() => void act("deliver", { locationId, paid: extraPaid })}
              disabled={busy || !locationId}
              className="flex-[2]"
            >
              {busy ? "…" : (labels.deliverT ?? labels.deliver)}
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={modal === "deleteOrder"}
        onClose={() => setModal(null)}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/sales/${sale.id}`, { method: "DELETE" });
            if (!res.ok) {
              setError((await res.json().catch(() => null))?.error ?? "failed");
              setModal(null);
              return;
            }
            setModal(null);
            if (onDone) onDone("__deleted__");
            else router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        title={labels.deleteOrderT ?? "Delete"}
        message={`${labels.deleteOrderM ?? ""}\n${sale.number} · ${num(total)}`}
        confirmLabel={labels.deleteOrderT ?? "Delete"}
      />
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.name} caption={zoom.name} onClose={() => setZoom(null)} />}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={`${labels.edit ?? "Edit"} · ${sale.number}`}
        icon="✎"
        width="xl"
      >
        {editing && formData && formLabels && (
          <SaleDocForm
            key={sale.id}
            locale={locale}
            mode={sale.kind === "ORDER" ? "order" : "ticket"}
            channel={(sale.channel as "VAN" | "POS" | "DEPOT") ?? "VAN"}
            clients={formData.clients}
            products={formData.products}
            units={formData.units}
            tiers={formData.tiers}
            locations={formData.locations}
            remiseEnabled={formData.settings.remiseEnabled}
            creditEnabled={formData.settings.creditSalesEnabled}
            allowPieces={formData.settings.pieceSalesEnabled}
            defaultTierId={formData.tiers[0]?.id}
            editingId={sale.id}
            initial={{
              clientId: sale.client?.id ?? null,
              locationId: sale.locationId,
              tierId: sale.tierId,
              remise: Number(sale.remise ?? 0),
              paid: Number(sale.paid ?? 0),
              notes: sale.notes,
              // 3pack gift lines are derived from the purchases, never edited.
              lines: sale.lines.filter((l) => !l.isBonus).map((l) => ({
                productId: l.productId,
                unitId: l.unitId,
                qty: Number(l.qty),
                unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
                remise: Number(l.remise ?? 0),
              })),
            }}
            onCreated={() => {
              setEditing(false);
              onDone?.(sale.id);
            }}
            labels={formLabels}
          />
        )}
      </Modal>
    </div>
  );
}
