"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Truck, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BackButton } from "@/components/ui/BackButton";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  DECLARED: "bg-amber-500/10 text-amber-600",
  CONFIRMED: "bg-emerald-500/10 text-emerald-600",
  REJECTED: "bg-red-500/10 text-red-500",
  CANCELLED: "bg-gray-500/10 text-gray-500",
};

type Row = {
  id: string;
  number: string;
  date: string;
  status: string;
  cashAmount: unknown;
  fromLocation: { id: string; name: string; kind: string };
  toLocation: { id: string; name: string; kind: string };
  lines: Array<{
    declaredQty: unknown;
    confirmedQty: unknown;
    product: { name: string; images: Array<{ url: string }> };
  }>;
};

type Preset = "all" | "today" | "week" | "month" | "custom";

function PlaceIcon({ kind }: { kind: string }) {
  return kind === "VAN"
    ? <Truck size={15} className="shrink-0 text-(--brand-600)" />
    : <Warehouse size={15} className="shrink-0 text-(--brand-600)" />;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TransfersJournal({
  locale,
  initial,
  locations,
  labels,
  statusLabel,
}: {
  locale: string;
  initial: Row[];
  locations: Array<{ id: string; name: string; kind: string }>;
  labels: Record<string, string>;
  statusLabel: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [status, setStatus] = useState("");
  const needle = q.trim().toLowerCase();

  const range = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (preset === "today") return { from: startOfDay, to: null as Date | null };
    if (preset === "week") {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return { from: d, to: null };
    }
    if (preset === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    if (preset === "custom") {
      return {
        from: fromDate ? new Date(`${fromDate}T00:00:00`) : null,
        to: toDate ? new Date(`${toDate}T23:59:59`) : null,
      };
    }
    return { from: null as Date | null, to: null as Date | null };
  }, [preset, fromDate, toDate]);

  const filtered = useMemo(
    () =>
      initial.filter((r) => {
        const d = new Date(r.date);
        if (range.from && d < range.from) return false;
        if (range.to && d > range.to) return false;
        if (fromId && r.fromLocation.id !== fromId) return false;
        if (toId && r.toLocation.id !== toId) return false;
        if (status && r.status !== status) return false;
        if (needle && !(r.number.toLowerCase().includes(needle) || r.lines.some((l) => l.product.name.toLowerCase().includes(needle)))) return false;
        return true;
      }),
    [initial, range, fromId, toId, status, needle]
  );

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: Row[]; units: number }>();
    for (const r of filtered) {
      const d = new Date(r.date);
      const k = dayKey(d);
      let g = map.get(k);
      if (!g) {
        g = { label: d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }), rows: [], units: 0 };
        map.set(k, g);
      }
      g.rows.push(r);
      g.units += r.lines.reduce((s, l) => s + Number(l.confirmedQty ?? l.declaredQty ?? 0), 0);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered, locale]);

  const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none";

  return (
    <div className="space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/inventory`} />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{labels.title}</h1>
        <Link href={`/${locale}/inventory/transfers/new`}>
          <Button>{labels.neW}</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", labels.statusAll],
              ["today", labels.fToday],
              ["week", labels.fWeek],
              ["month", labels.fMonth],
              ["custom", labels.fCustom],
            ] as Array<[Preset, string]>
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setPreset(v)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-black transition-colors",
                preset === v ? "bg-gradient-brand text-white shadow" : "bg-(--bg-sunken) opacity-70 hover:opacity-100"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={inputCls} aria-label={labels.from}>
            <option value="">{labels.from}: —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select value={toId} onChange={(e) => setToId(e.target.value)} className={inputCls} aria-label={labels.to}>
            <option value="">{labels.to}: —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} aria-label={labels.status}>
            <option value="">{labels.statusAll}</option>
            {Object.keys(STATUS_COLOR).map((s) => (
              <option key={s} value={s}>{statusLabel[s] ?? s}</option>
            ))}
          </select>
          {preset === "custom" ? (
            <div className="flex gap-2">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label={labels.dateFrom} />
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label={labels.dateTo} />
            </div>
          ) : (
            <div className="flex items-center px-1 text-xs font-bold tabular-nums opacity-60">
              {filtered.length} · {groups.reduce((s, [, g]) => s + g.units, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          )}
        </div>
      </div>

      {filtered.length === 0 && <p className="py-10 text-center text-sm opacity-60">{labels.empty}</p>}

      {groups.map(([key, g]) => (
        <div key={key} className="space-y-2">
          <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between bg-(--bg-surface)/95 px-1 py-1 backdrop-blur">
            <span className="text-sm font-black">{g.label}</span>
            <span className="text-[11px] font-bold tabular-nums opacity-60">
              {g.rows.length} · {g.units.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          {g.rows.map((r) => (
            <Link
              key={r.id}
              href={`/${locale}/inventory/transfers/${r.id}`}
              className="flex items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-colors hover:border-(--brand-500)"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div className="flex shrink-0 -space-x-2 rtl:space-x-reverse">
                  {r.lines.slice(0, 3).map((l, i) =>
                    l.product.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={l.product.images[0].url} alt={l.product.name} className="h-9 w-9 rounded-xl border-2 border-(--bg-overlay) object-cover" loading="lazy" />
                    ) : (
                      <span key={i} className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-(--bg-overlay) bg-(--bg-sunken) text-sm">📦</span>
                    )
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-bold">
                    <span className="tabular-nums opacity-60">{r.number}</span>
                    <span className="flex min-w-0 items-center gap-1">
                      <PlaceIcon kind={r.fromLocation.kind} />
                      <bdi className="truncate">{r.fromLocation.name}</bdi>
                    </span>
                    <span className="opacity-40 rtl:-scale-x-100">→</span>
                    <span className="flex min-w-0 items-center gap-1">
                      <PlaceIcon kind={r.toLocation.kind} />
                      <bdi className="truncate">{r.toLocation.name}</bdi>
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] opacity-60">
                    {r.lines.length} · {r.lines.reduce((s, l) => s + Number(l.confirmedQty ?? l.declaredQty ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    {Number(r.cashAmount) > 0 ? ` · 💵 ${Number(r.cashAmount).toLocaleString()}` : ""}
                  </div>
                </div>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-black", STATUS_COLOR[r.status] ?? "")}>
                {statusLabel[r.status] ?? r.status}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
