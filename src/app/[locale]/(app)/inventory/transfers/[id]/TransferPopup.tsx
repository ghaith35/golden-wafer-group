"use client";

import { useEffect, useState } from "react";
import { Truck, Warehouse } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { TransferResolve } from "./TransferResolve";
import { LineQty } from "./LineQty";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  DECLARED: "bg-amber-500/10 text-amber-600",
  CONFIRMED: "bg-emerald-500/10 text-emerald-600",
  REJECTED: "bg-red-500/10 text-red-500",
  CANCELLED: "bg-gray-500/10 text-gray-500",
};

type ApiLine = {
  id: string;
  declaredQty: number | string;
  confirmedQty: number | string | null;
  product: {
    id: string;
    name: string;
    images?: Array<{ url: string }>;
    conversions?: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
    baseUnit?: { name: string } | null;
  };
};

type ApiTransfer = {
  id: string;
  number: string;
  status: string;
  date: string;
  cashAmount: number | string;
  notes: string | null;
  fromLocation: { id: string; name: string; kind: string; imageUrl?: string | null; matricule?: string | null };
  toLocation: { id: string; name: string; kind: string; imageUrl?: string | null; matricule?: string | null };
  lines: ApiLine[];
};

function LocThumb({ loc, size = "md" }: { loc: ApiTransfer["fromLocation"]; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "h-11 w-16" : "h-9 w-12";
  if (loc.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={loc.imageUrl} alt={loc.name} className={`${cls} shrink-0 rounded-lg object-cover`} loading="lazy" />;
  }
  return (
    <span className={`${cls} flex shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken)`}>
      {loc.kind === "VAN"
        ? <Truck size={16} className="text-(--brand-600)" />
        : <Warehouse size={16} className="text-(--brand-600)" />}
    </span>
  );
}

/// Transfer detail as an in-board popup: header, route, lines and
/// confirm/reject/cancel when still declared — no page navigation.
export function TransferPopup({
  transferId,
  locale,
  labels,
  onDone,
}: {
  transferId: string;
  locale: string;
  labels: Record<string, string>;
  onDone: () => void;
}) {
  const [row, setRow] = useState<ApiTransfer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    fetch(`/api/transfers/${transferId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!dead) {
          if (d) setRow(d);
          else setFailed(true);
        }
      })
      .catch(async () => {
        // Offline: fall back to the synced snapshot's declared transfers so
        // the van can still confirm/reject (queued) without connection.
        if (dead) return;
        try {
          const { getVanSnapshot } = await import("@/lib/sync/client");
          const s = await getVanSnapshot();
          const t = s?.transfers?.find((x) => x.id === transferId);
          if (t) {
            const vanIds = new Set((s?.vans ?? []).map((v) => v.id));
            const loc = (id: string, name: string) => ({
              id, name, kind: vanIds.has(id) ? "VAN" : "DEPOT",
            });
            setRow({
              id: t.id,
              number: t.number,
              status: t.status,
              date: t.date,
              cashAmount: t.cashAmount ?? 0,
              notes: t.notes,
              fromLocation: loc(t.fromLocationId, t.fromLocation.name),
              toLocation: loc(t.toLocationId, t.toLocation.name),
              lines: t.lines.map((l) => ({
                id: l.id,
                declaredQty: l.declaredQty,
                confirmedQty: l.confirmedQty,
                product: { id: l.product.id, name: l.product.name },
              })),
            });
          } else {
            setFailed(true);
          }
        } catch {
          if (!dead) setFailed(true);
        }
      });
    return () => {
      dead = true;
    };
  }, [transferId]);

  if (failed) return <p className="py-10 text-center text-sm text-red-500">failed</p>;
  if (!row) return <p className="py-10 text-center text-sm opacity-60">…</p>;

  const statusLabel =
    row.status === "DECLARED" ? (labels.declared ?? "DECLARED")
    : row.status === "CONFIRMED" ? (labels.confirmed ?? "CONFIRMED")
    : row.status === "REJECTED" ? (labels.rejected ?? "REJECTED")
    : (labels.cancelled ?? "CANCELLED");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-black tabular-nums">{row.number}</h3>
        <span className={cn("rounded-full px-3 py-1 text-xs font-black", STATUS_COLOR[row.status])}>{statusLabel}</span>
      </div>

      <Card>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
            <LocThumb loc={row.fromLocation} />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase opacity-60">{labels.from ?? "from"}</div>
              <div className="truncate text-sm font-black">{row.fromLocation.name}</div>
            </div>
          </div>
          <span className="shrink-0 font-black opacity-40 rtl:-scale-x-100">→</span>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
            <LocThumb loc={row.toLocation} />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase opacity-60">{labels.to ?? "to"}</div>
              <div className="truncate text-sm font-black">{row.toLocation.name}</div>
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span><b>{labels.cashAmount ?? "cash"}:</b> <span className="tabular-nums">{String(row.cashAmount)}</span></span>
          <span className="opacity-60">{new Date(row.date).toLocaleDateString(locale)}</span>
        </div>
        {row.notes && <div className="mt-1 text-sm opacity-70">{row.notes}</div>}
      </Card>

      <Card>
        <div className="max-h-[calc(var(--vh)*0.4)] space-y-1.5 overflow-y-auto pe-0.5">
          {row.lines.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-xl bg-(--bg-sunken) px-2 py-1.5">
              {l.product.images?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.product.images[0].url} alt={l.product.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" loading="lazy" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-overlay) text-sm">📦</span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{l.product.name}</span>
              <span className="shrink-0 text-sm tabular-nums" dir="ltr">
                <LineQty
                  declared={l.declaredQty}
                  confirmed={l.confirmedQty}
                  conversions={l.product.conversions ?? []}
                  baseName={l.product.baseUnit?.name ?? ""}
                />
              </span>
            </div>
          ))}
        </div>
      </Card>

      {row.status === "DECLARED" && (
        <TransferResolve
          transferId={row.id}
          lines={row.lines.map((l) => ({
            id: l.id,
            declaredQty: Number(l.declaredQty),
            confirmedQty: l.confirmedQty != null ? Number(l.confirmedQty) : null,
            product: {
              name: l.product.name,
              imageUrl: l.product.images?.[0]?.url ?? null,
              conversions: l.product.conversions ?? [],
              baseName: l.product.baseUnit?.name ?? "",
            },
          }))}
          labels={{
            confirm: labels.confirm ?? "confirm",
            reject: labels.reject ?? "reject",
            cancel: labels.cancel ?? "cancel",
            queued: labels.queued ?? "",
          }}
          onDone={onDone}
        />
      )}
    </div>
  );
}
