"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bus, Printer, Store } from "lucide-react";
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
  client: { id: string; name: string; code: string; gpsLat?: number | null; gpsLng?: number | null } | null;
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
  locations: Array<{ id: string; name: string; kind?: string }>;
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
  const [modal, setModal] = useState<null | "load" | "assign" | "deliver" | "invoice" | "cancel" | "uncancel">(null);
  const [editing, setEditing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(d?.user?.role === "Admin"))
      .catch(() => setIsAdmin(false));
  }, []);
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

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      {/* ── Khiata-style header: badge + paid dot, client, metric trio ── */}
      <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-lg bg-(--brand-500)/10 px-2 py-0.5 text-[11px] font-black text-(--brand-600)">
                {sale.kind} {sale.number}
              </span>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-black",
                due <= 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"
              )}>
                {due <= 0 ? "✓" : "!"}
              </span>
              <span className="rounded-full bg-(--bg-sunken) px-2 py-0.5 text-[10px] font-black opacity-70">
                {sale.status}
              </span>
            </div>
            <div className="mt-1.5 truncate text-base font-black">
              {sale.client ? sale.client.name : labels.walkin}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold opacity-60">
              {sale.client && <span className="font-mono" dir="ltr">{sale.client.code}</span>}
              {sale.location && (
                <span className="flex items-center gap-1">
                  {sale.location.kind === "VAN" ? <Bus size={12} /> : <Store size={12} />}
                  {sale.location.name}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5 text-center">
            <MiniMetric label={labels.total} value={num(total)} tone="teal" />
            <MiniMetric label={labels.paid} value={num(paid)} tone="gold" />
            <MiniMetric label={labels.due} value={num(due)} tone={due > 0 ? "rose" : "teal"} />
          </div>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-(--bg-sunken)">
          <div
            className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-(--border-default)")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <SiteCheckCard sale={sale} labels={labels} />
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-black uppercase tracking-wide opacity-50">
            {sale.lines?.length ?? 0} · {labels.total}
          </span>
          <span className="text-base font-black tabular-nums">{num(total)}</span>
        </div>
        <div className="table-shell">
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
            const p = l.product;
            if (!p) {
              return (
                <tr key={l.id} className="border-t border-(--border-subtle)">
                  <td className="px-1 py-2 opacity-60">—</td>
                  <td colSpan={4} />
                  <td className="px-1 py-2 text-end font-black tabular-nums" dir="ltr">{dzMoney(Number(l.lineTotal))}</td>
                </tr>
              );
            }
            const convs = p.conversions ?? [];
            const imgs = p.images ?? [];
            const f = factorOf({ ...p, conversions: convs }, l.unitId ?? "");
            const firstPack = convs.filter((c) => Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor))[0];
            let uname = !l.unitId || l.unitId === p.baseUnitId
              ? (p.baseUnit?.name ?? "")
              : (convs.find((c) => c.unitId === l.unitId)?.unit.name ?? "");
            if (!uname) uname = firstPack?.unit.name ?? p.baseUnit?.name ?? "";
            const unitPrice = Number(l.unitPrice);
            const nf = normFactor(f);
            const base = Number(l.baseQty ?? l.qty);
            const baseName = p.baseUnit?.name ?? "";
            // Pack side + piece side, whichever the line unit is.
            const packF = firstPack ? normFactor(Number(firstPack.factor)) : 0;
            const packName = f > 1 ? uname : (firstPack?.unit.name ?? "");
            const packPrice = f > 1 ? unitPrice : packF > 0 ? unitPrice * packF : 0;
            const piecePrice = f > 1 ? unitPrice / nf : unitPrice;
            const packQty = packF > 0 ? Math.round((base / packF) * 100) / 100 : 0;
            return (
              <tr key={l.id} className="border-t border-(--border-subtle) align-top">
                <td className="px-1 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {imgs[0] ? (
                      <button
                        type="button"
                        onClick={() => setZoom({ src: imgs[0].url, name: p.name })}
                        aria-label={p.name}
                        className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-500)"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgs[0].url} alt={p.name} className="h-9 w-9 rounded-lg object-cover" loading="lazy" />
                      </button>
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-base opacity-50">📦</div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold">{p.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] opacity-60">
                        <span className="rounded-md bg-(--brand-500)/10 px-1.5 py-0.5 font-black tabular-nums text-(--brand-600)" dir="ltr">×{Number(l.qty)} {uname}</span>
                        {p.reference && <span className="truncate font-mono" dir="ltr">{p.reference}</span>}
                        {Number(l.remise) > 0 && <span dir="ltr">− {dzMoney(Number(l.remise))}</span>}
                      </div>
                      {packF > 0 && (
                        <div className="mt-0.5 truncate text-[10px] font-bold text-(--brand-600)">
                          <bdi>1 {packName} = {dz(packF)} {baseName}</bdi>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-1 py-2 text-end tabular-nums" dir="ltr">
                  <div className="text-[13px] font-bold">{dzMoney(piecePrice)}</div>
                  <div className="truncate text-[10px] opacity-50">{baseName}</div>
                </td>
                <td className="px-1 py-2 text-end tabular-nums" dir="ltr">
                  {packName ? (
                    <>
                      <div className="text-[13px] font-bold text-(--brand-600)">{dzMoney(packPrice)}</div>
                      <div className="truncate text-[10px] opacity-50">{packName}</div>
                    </>
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </td>
                <td className="px-1 py-2 text-end font-bold tabular-nums" dir="ltr">
                  {packF > 0 ? dz(packQty) : <span className="opacity-30">—</span>}
                </td>
                <td className="px-1 py-2 text-end tabular-nums" dir="ltr">
                  <div className="text-[13px] font-bold">{dz(base)}</div>
                  <div className="truncate text-[10px] opacity-50">{baseName}</div>
                </td>
                <td className="px-1 py-2 text-end text-[13px] font-black tabular-nums" dir="ltr">{dzMoney(Number(l.lineTotal))}</td>
              </tr>
            );
          })}
          </tbody>
        </table>
        </div>
      </Card>
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
      <div className="flex flex-wrap gap-2">
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
      </div>

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
              {locations.filter((l) => l.kind === "VAN").map((l) => (
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
                    {p.name} · <bdi>{packF > 0 ? `${dz(Math.round((need / packF) * 100) / 100)} ${firstPack!.unit.name}` : `${dz(need)}`}</bdi>
                  </span>
                  <span className="shrink-0 font-black">
                    🏭 {depotQty == null ? "…" : (<><bdi>{packF > 0 ? dz(Math.round((depotQty / packF) * 100) / 100) : dz(depotQty)}</bdi> {packF > 0 ? firstPack!.unit.name : (p.baseUnit?.name ?? "")}</>)}
                  </span>
                </div>
              );
            })}
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal(null)} className="flex-1">{labels.cancel}</Button>
            <Button
              onClick={() => void act("confirm-load", { locationId: assignTo })}
              disabled={busy || !assignTo}
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
              {locations.map((l) => (
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
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
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
            mode="ticket"
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
              lines: sale.lines.map((l) => ({
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
