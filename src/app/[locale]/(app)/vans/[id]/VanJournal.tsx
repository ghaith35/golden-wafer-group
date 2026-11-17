"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ShoppingCart, Undo2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { packBreakdown } from "@/components/products/UnitQty";
import { mixedColisTotal } from "@/lib/products/colisage";
import { cn } from "@/lib/utils";
import { dz, dzMoney } from "@/lib/format";
import { useDataVersion } from "@/lib/data-sync";

type JProduct = {
  id: string;
  name: string;
  baseUnit: { name: string } | null;
  conversions: Array<{ unitId: string; factor: number; unit: { name: string } }>;
};

type JLine = { product: JProduct; qty: number };

type JournalData = {
  transfers: Array<{
    id: string;
    number: string;
    status: string;
    date: string;
    cashAmount: number;
    fromLocationId: string;
    toLocationId: string;
    fromLocation: { id: string; name: string };
    toLocation: { id: string; name: string };
    lines: Array<{ product: JProduct; declaredQty: number; confirmedQty: number | null }>;
  }>;
  sales: Array<{
    id: string;
    number: string;
    date: string;
    client: { name: string } | null;
    lines: Array<{ product: JProduct; baseQty: number }>;
  }>;
  returns: Array<{
    id: string;
    number: string;
    date: string;
    client: { name: string } | null;
    lines: Array<{ product: JProduct; baseQty: number }>;
  }>;
  losses: Array<{ id: string; date: string; motive: string; product: JProduct; baseQty: number }>;
};

type Entry = {
  key: string;
  time: string;
  ts: number;
  dir: "in" | "out";
  counted: boolean;
  icon: "load" | "unload" | "sale" | "return" | "loss";
  title: string;
  sub?: string;
  lines: JLine[];
};

const fmt = (v: number) => dz(v);

function packsOf(p: JProduct) {
  return p.conversions
    .filter((c) => Number(c.factor) > 1)
    .sort((a, b) => Number(a.factor) - Number(b.factor))
    .map((c) => ({ name: c.unit.name, factor: Number(c.factor) }));
}

function LineQty({ product, qty }: { product: JProduct; qty: number }) {
  const convs = product.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) }));
  const uname = (id: string) => product.conversions.find((c) => c.unitId === id)?.unit.name ?? "";
  return (
    <span className="shrink-0 text-end tabular-nums">
      <span className="block text-sm font-black">{packBreakdown(qty, convs, uname, product.baseUnit?.name ?? "")}</span>
      <span className="block text-[11px] font-bold opacity-60" dir="ltr">
        = <bdi dir="ltr">{dz(qty)}</bdi> <bdi dir="auto">{product.baseUnit?.name ?? ""}</bdi>
      </span>
    </span>
  );
}

export function VanJournal({
  vanId,
  labels,
}: {
  vanId: string;
  labels: Record<string, string>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<JournalData | null>(null);
  const [busy, setBusy] = useState(true);
  /// Null data after load = unreachable server (offline): never present an
  /// empty journal as if the day had no movements.
  const [unreachable, setUnreachable] = useState(false);

  const dataV = useDataVersion();
  useEffect(() => {
    let live = true;
    setUnreachable(false);
    fetch(`/api/vans/${vanId}/journal?date=${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live) {
          setData(d);
          if (!d) setUnreachable(true);
        }
      })
      .catch(() => {
        if (live) {
          setData(null);
          setUnreachable(true);
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [vanId, date, dataV]);

  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const out: Entry[] = [];
    for (const t of data.transfers) {
      const inbound = t.toLocationId === vanId;
      const counted = t.status === "CONFIRMED";
      out.push({
        key: `t-${t.id}`,
        time: t.date,
        ts: new Date(t.date).getTime(),
        dir: inbound ? "in" : "out",
        counted,
        icon: inbound ? "load" : "unload",
        title: `${t.number} · ${inbound ? t.fromLocation.name : t.toLocation.name}`,
        sub: t.cashAmount > 0 ? `💵 ${fmt(t.cashAmount)}` : undefined,
        lines: t.lines.map((l) => ({
          product: l.product,
          qty: counted ? (l.confirmedQty ?? l.declaredQty) : l.declaredQty,
        })),
      });
    }
    for (const s of data.sales) {
      out.push({
        key: `s-${s.id}`,
        time: s.date,
        ts: new Date(s.date).getTime(),
        dir: "out",
        counted: true,
        icon: "sale",
        title: `${s.number}${s.client ? ` · ${s.client.name}` : ""}`,
        lines: s.lines.map((l) => ({ product: l.product, qty: l.baseQty })),
      });
    }
    for (const r of data.returns) {
      out.push({
        key: `r-${r.id}`,
        time: r.date,
        ts: new Date(r.date).getTime(),
        dir: "in",
        counted: true,
        icon: "return",
        title: `${r.number}${r.client ? ` · ${r.client.name}` : ""}`,
        lines: r.lines.map((l) => ({ product: l.product, qty: l.baseQty })),
      });
    }
    for (const l of data.losses) {
      out.push({
        key: `l-${l.id}`,
        time: l.date,
        ts: new Date(l.date).getTime(),
        dir: "out",
        counted: true,
        icon: "loss",
        title: l.motive,
        lines: [{ product: l.product, qty: l.baseQty }],
      });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [data, vanId]);

  const totals = useMemo(() => {
    const rows = entries
      .filter((e) => e.counted)
      .flatMap((e) => e.lines.map((l) => ({ dir: e.dir, qty: l.qty, packsAsc: packsOf(l.product) })));
    const sum = (dir: "in" | "out") =>
      mixedColisTotal(rows.filter((r) => r.dir === dir).map((r) => ({ qty: r.qty, packsAsc: r.packsAsc })));
    return { in: sum("in"), out: sum("out") };
  }, [entries]);

  const totalLine = (t: { packs: number; packName: string | null; units: number }) => (
    <>
      {dz(t.units)}
      {t.packs > 0 && t.packName && <span className="text-(--brand-600)"> · <bdi dir="ltr">{dz(t.packs)}</bdi> <bdi dir="auto">{t.packName}</bdi></span>}
    </>
  );

  const iconFor = (icon: Entry["icon"]) => {
    const cls = "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl";
    if (icon === "load") return <span className={cn(cls, "bg-emerald-500/15 text-emerald-600")}><ArrowDownToLine size={16} /></span>;
    if (icon === "unload") return <span className={cn(cls, "bg-amber-500/15 text-amber-600")}><ArrowUpFromLine size={16} /></span>;
    if (icon === "sale") return <span className={cn(cls, "bg-red-500/10 text-red-500")}><ShoppingCart size={16} /></span>;
    if (icon === "return") return <span className={cn(cls, "bg-emerald-500/15 text-emerald-600")}><Undo2 size={16} /></span>;
    return <span className={cn(cls, "bg-gray-500/10 text-gray-500")}><Trash2 size={16} /></span>;
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={(e) => { setBusy(true); setDate(e.target.value); }} className="w-40" />
        {!busy && (
          <div className="flex flex-1 flex-wrap gap-2 text-xs font-black tabular-nums">
            <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-600">
              {labels.stockIn}: {totalLine(totals.in)}
            </span>
            <span className="rounded-lg bg-red-500/10 px-2 py-1 text-red-500">
              {labels.stockOut}: {totalLine(totals.out)}
            </span>
          </div>
        )}
      </div>

      {busy && !data && <p className="py-6 text-center text-sm opacity-60">…</p>}
      {!busy && unreachable && (
        <p className="rounded-xl bg-amber-500/10 p-3 text-center text-xs font-black text-amber-600" dir="auto">
          📴 {labels.offline ?? "offline"}
        </p>
      )}
      {!busy && !unreachable && entries.length === 0 && <p className="py-6 text-center text-sm opacity-60">{labels.noMovements}</p>}

      <div className="space-y-2">
        {entries.map((e) => (
          <div
            key={e.key}
            className={cn(
              "rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3",
              !e.counted && "border-dashed opacity-70"
            )}
          >
            <div className="flex items-center gap-2.5">
              {iconFor(e.icon)}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{e.title}</div>
                <div className="text-[11px] opacity-60">
                  {new Date(e.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {e.sub ? ` · ${e.sub}` : ""}
                  {!e.counted && labels.pending ? ` · ${labels.pending}` : ""}
                </div>
              </div>
            </div>
            <div className="mt-2 space-y-1 border-t border-(--border-subtle) pt-2">
              {e.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{l.product.name}</span>
                  <LineQty product={l.product} qty={l.qty} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
