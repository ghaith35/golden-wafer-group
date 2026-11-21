"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bus, Check, FileText, Plus, ReceiptText, Search, Store,
  TrendingUp, Wallet, WifiOff, X, CircleDollarSign, type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { SaleDocForm } from "./SaleDocForm";
import { SaleActions, type SaleDetail } from "./[id]/SaleActions";
import type { SaleFormData } from "./saleRefs";
import { dzMoney } from "@/lib/format";
import { compareNatural } from "@/lib/sort";
import { getUnsyncedDocKeys } from "@/lib/sync/client";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/data-sync";
import { useCountUp } from "@/components/dashboard/charts";
import { Avatar } from "@/components/ui/Avatar";
import { ClientName } from "@/components/clients/ClientName";
import { matchClient } from "@/lib/clients/display";

type Row = {
  id: string;
  number: string;
  kind?: string;
  status: string;
  total: unknown;
  paid: unknown;
  date: unknown;
  isPortal: boolean;
  offList: boolean;
  client: { name: string; code: string; gpsLat?: number | string | null; gpsLng?: number | string | null } | null;
  location: { id: string; name: string; matricule: string | null; kind: string } | null;
};

export type SalesStats = {
  nowIso: string;
  today: { total: number; count: number; prev: number };
  range: { total: number; paid: number; count: number; prev: number };
  series: number[];
  dayCount: number[];
  byVan: Record<string, { count: number; total: number }>;
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-(--bg-sunken) text-(--text-secondary)",
  CONFIRMED: "bg-sky-500/15 text-sky-600",
  DELIVERED: "bg-emerald-500/15 text-emerald-600",
  INVOICED: "bg-(--brand-500)/15 text-(--gold-text)",
  CANCELLED: "bg-red-500/15 text-red-500",
};

function pct(cur: number, prev: number): number | null {
  if (prev <= 0) return cur > 0 ? null : 0;
  return ((cur - prev) / prev) * 100;
}
function Delta({ cur, prev, label }: { cur: number; prev: number; label?: string }) {
  const d = pct(cur, prev);
  if (cur === 0 && prev === 0) return null;
  if (d === null) return <span className="rounded-full bg-(--bg-sunken) px-1.5 text-[10px] font-black text-(--text-tertiary)">NEW</span>;
  const up = d >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span dir="ltr" className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 text-[11px] font-black tabular-nums", up ? "bg-emerald-500/15 text-(--semantic-success)" : "bg-red-500/15 text-(--semantic-danger)")}>
        <Icon size={11} strokeWidth={3} />{Math.abs(d) >= 1000 ? ">999" : Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}%
      </span>
      {label && <span className="hidden text-[10px] font-bold text-(--text-tertiary) sm:inline">{label}</span>}
    </span>
  );
}

function Money({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value, 700);
  return <span className={cn("tabular-nums", className)}>{dzMoney(Math.round(v))}</span>;
}

function StatCard({
  icon: Icon, tone, label, children, footer, className,
}: { icon: LucideIcon; tone: string; label: string; children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("group relative flex min-w-[172px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl lg:min-w-0 lg:shrink border border-(--border-default) bg-(--bg-overlay) p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-(--border-strong)", className)}>
      <span aria-hidden className={cn("pointer-events-none absolute -end-6 -top-8 h-24 w-24 rounded-full bg-current opacity-[0.10] blur-2xl transition-opacity duration-300 group-hover:opacity-25", tone)} />
      <div className="relative flex items-center gap-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", tone, "bg-current/0")}>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-current/15"><Icon size={16} /></span>
        </span>
        <span className="min-w-0 truncate text-[11px] font-bold text-(--text-tertiary)">{label}</span>
      </div>
      <div className="relative mt-1.5 min-w-0 truncate text-[clamp(17px,1.7vw,24px)] font-black leading-tight tracking-tight text-(--text-primary)">{children}</div>
      {footer && <div className="relative mt-1.5 flex min-h-5 items-center gap-2 lg:[@media(max-height:820px)]:hidden">{footer}</div>}
    </div>
  );
}

function Spark({ values, mark }: { values: number[]; mark?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-6 min-w-0 flex-1 items-end gap-px" dir="ltr" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn("min-h-[2px] flex-1 rounded-t-[2px]", i + 1 === mark ? "bg-(--brand-500)" : "bg-(--brand-500)/35")}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function SalesClient({
  locale, kind, year, month, day, days, years, months, rows: initial, stats, formData, formLabels, labels, detailLabels,
}: {
  locale: string;
  kind: string;
  year: number;
  month: number;
  day: number;
  days: number;
  years: number[];
  months: number[];
  rows: Row[];
  stats: SalesStats;
  formData: SaleFormData;
  formLabels: Record<string, string>;
  labels: Record<string, string>;
  detailLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useSyncedState(initial);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  useEffect(() => {
    let on = true;
    const load = () => {
      getUnsyncedDocKeys().then((s) => { if (on) setUnsynced(s); }).catch(() => {});
    };
    load();
    window.addEventListener("online", load);
    window.addEventListener("focus", load);
    return () => {
      on = false;
      window.removeEventListener("online", load);
      window.removeEventListener("focus", load);
    };
  }, []);
  const [modal, setModal] = useState<"ticket" | null>(null);
  const [q, setQ] = useState("");
  const [fVan, setFVan] = useState("");
  const [fPay, setFPay] = useState<"all" | "settled" | "due">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loc = `${locale === "ar" ? "ar-DZ" : locale}-u-nu-latn`;
  const now = useMemo(() => new Date(stats.nowIso), [stats.nowIso]);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false }), [loc]);
  const dayLabel = (d: Date) => {
    const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return labels.today;
    if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return labels.yesterday;
    return new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }).format(d);
  };
  const monthName = (m: number) => new Intl.DateTimeFormat(loc, { month: "long" }).format(new Date(year, m - 1, 1));
  const kindLabel = (k?: string) => (k === "TICKET" ? labels.kindTicket : k === "DELIVERY" ? labels.kindDelivery : k === "INVOICE" ? labels.kindInvoice : "");
  const statusLabel = (s: string) => labels[s.toLowerCase()] ?? s;

  /// All vans/depots — even with zero sales. Counts + revenue from the whole range.
  const vans = useMemo(() => {
    return (formData.locations as Array<{ id: string; name: string; matricule?: string | null; kind?: string }>)
      .map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind ?? "",
        count: stats.byVan[l.id]?.count ?? 0,
        total: stats.byVan[l.id]?.total ?? 0,
      }))
      .sort((a, b) =>
        a.kind !== b.kind ? (a.kind === "VAN" ? -1 : 1) : b.total - a.total || compareNatural(a.name, b.name, locale)
      );
  }, [stats.byVan, formData.locations, locale]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (fVan && r.location?.id !== fVan) return false;
        const due = Number(r.total) - Number(r.paid ?? 0) > 0.005;
        if (fPay === "due" && !due) return false;
        if (fPay === "settled" && due) return false;
        if (!needle) return true;
        return (
          r.number.toLowerCase().includes(needle) ||
          matchClient(q, r.client ?? {}) ||
          (r.location?.name ?? "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());
  }, [rows, q, fVan, fPay]);

  const sum = useMemo(() => {
    const total = visible.reduce((s, r) => s + Number(r.total), 0);
    const paid = visible.reduce((s, r) => s + Number(r.paid ?? 0), 0);
    return { total, paid, due: total - paid };
  }, [visible]);

  /// Rows grouped by calendar day (newest first) with per-day totals.
  const groups = useMemo(() => {
    const m = new Map<string, { date: Date; rows: Row[]; total: number }>();
    for (const r of visible) {
      const d = new Date(r.date as string);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const g = m.get(k) ?? { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), rows: [], total: 0 };
      g.rows.push(r);
      g.total += Number(r.total);
      m.set(k, g);
    }
    return [...m.values()];
  }, [visible]);

  async function select(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/sales/${id}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json().catch(() => null);
        if (d && d.id) setDetail(d);
      }
    } catch { /* offline */ } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    setRows(initial);
    setSelectedId(null);
    setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, year, month, day]);

  function go(y: number, m: number, d: number, k: string = kind) {
    const p = new URLSearchParams();
    if (k) p.set("kind", k);
    p.set("year", String(y));
    p.set("month", String(m));
    if (d > 0) p.set("day", String(d));
    router.push(`/${locale}/sales?${p.toString()}`);
  }

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
  }, [fVan]);

  /// After an inline action: refresh the detail and patch the list row.
  async function detailChanged(newId?: string) {
    const id = newId ?? selectedId;
    if (!id) return;
    if (newId && newId !== selectedId) setSelectedId(newId);
    try {
      const res = await fetch(`/api/sales/${id}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json().catch(() => null);
        if (!d || !d.id) return;
        setDetail(d);
        setRows((prev) =>
          prev.map((r) =>
            r.id === d.id
              ? { ...r, status: d.status, total: d.total, paid: d.paid, location: d.location ? { id: d.location.id, name: d.location.name, matricule: d.location.matricule ?? null, kind: d.location.kind ?? "" } : r.location }
              : r
          )
        );
      }
    } catch { /* offline */ }
  }

  function created(id: string) {
    setModal(null);
    router.push(`/${locale}/sales/${id}`);
  }

  // Desktop: open the newest invoice by default so the detail panel is never empty.
  useEffect(() => {
    if (selectedId !== null || detailLoading) return;
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 1024px)").matches) return;
    const first = visible[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (first) void select(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedId]);

  // Keep the selected day chip in view.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [day, month, year]);

  const rangeTitle = day ? `${day} ${monthName(month)}` : monthName(month);
  const collectedPct = stats.range.total > 0 ? Math.min(100, (stats.range.paid / stats.range.total) * 100) : 0;
  const rangeDue = Math.max(0, stats.range.total - stats.range.paid);
  const avg = stats.range.count > 0 ? stats.range.total / stats.range.count : 0;
  const filtersOn = !!(q || fVan || fPay !== "all");
  const sheetOpen = selectedId !== null;
  const maxDay = Math.max(1, ...stats.series);

  const kinds = [
    { v: "", label: labels.all },
    { v: "TICKET", label: labels.tickets },
    { v: "DELIVERY", label: labels.deliveries },
    { v: "INVOICE", label: labels.invoices },
  ];
  const pays: Array<{ v: "all" | "settled" | "due"; label: string; Icon?: LucideIcon }> = [
    { v: "all", label: labels.payAll },
    { v: "settled", label: labels.paySettled, Icon: Check },
    { v: "due", label: labels.payDue, Icon: CircleDollarSign },
  ];
  const selectCls = "h-11 shrink-0 rounded-xl border border-(--border-default) bg-(--bg-surface) px-3 text-sm font-black outline-none";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-hidden">
      {/* ── Hero KPIs ── */}
      <div className="-mx-1 flex shrink-0 snap-x gap-2.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0 lg:pb-0">
        <StatCard
          icon={ReceiptText}
          tone="text-emerald-500"
          label={labels.kpiToday}
          footer={<><Delta cur={stats.today.total} prev={stats.today.prev} label={labels.vsYesterday} /><span className="ms-auto text-[10px] font-black text-(--text-tertiary)">{stats.today.count} {labels.invoicesWord}</span></>}
        >
          <Money value={stats.today.total} />
        </StatCard>
        <StatCard
          icon={TrendingUp}
          tone="text-(--gold-text)"
          label={`${day ? "" : labels.kpiMonth + " · "}${rangeTitle}`}
          footer={<><Spark values={stats.series} mark={day || undefined} /><Delta cur={stats.range.total} prev={stats.range.prev} /></>}
        >
          <Money value={stats.range.total} />
        </StatCard>
        <StatCard
          icon={FileText}
          tone="text-sky-500"
          label={labels.kpiCount}
          footer={<span className="text-[10px] font-black text-(--text-tertiary)">{labels.avgShort}: <b className="tabular-nums text-(--text-secondary)">{dzMoney(Math.round(avg))}</b></span>}
        >
          <span className="tabular-nums">{stats.range.count}</span>
        </StatCard>
        <StatCard
          icon={Wallet}
          tone="text-teal-500"
          label={labels.collected}
          footer={
            <>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--bg-sunken)"><div className="gw-grow-x h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-300" style={{ width: `${Math.max(2, collectedPct)}%` }} /></div>
              <span className="text-[10px] font-black tabular-nums text-(--text-secondary)" dir="ltr">{collectedPct.toFixed(0)}%</span>
            </>
          }
        >
          <Money value={stats.range.paid} />
        </StatCard>
        <StatCard
          icon={CircleDollarSign}
          tone="text-rose-500"
          label={labels.kpiOutstanding}
                    footer={<span className="text-[10px] font-black text-(--text-tertiary)" dir="ltr">{(100 - collectedPct).toFixed(0)}% {labels.ofTotal}</span>}
        >
          <Money value={rangeDue} className={rangeDue > 0 ? "text-(--semantic-danger)" : "text-(--semantic-success)"} />
        </StatCard>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setModal("ticket")}
          className="bg-gradient-brand flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-black text-(--brand-contrast) transition-transform hover:-translate-y-0.5"
        >
          <Plus size={17} strokeWidth={3} />
          {labels.newTicket}
        </button>
        <label className="relative order-last min-w-[220px] flex-1 basis-full sm:order-none sm:basis-auto">
          <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-(--text-tertiary)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={labels.searchSales}
            className="h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) ps-10 pe-9 text-sm font-bold outline-none"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="clear" className="absolute end-2 top-1/2 flex h-7 min-h-0 w-7 min-w-0 -translate-y-1/2 items-center justify-center rounded-lg text-(--text-tertiary) hover:text-(--text-primary)">
              <X size={14} />
            </button>
          )}
        </label>
        <select value={year} onChange={(e) => go(Number(e.target.value), month, 0)} className={selectCls} aria-label={labels.year}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={(e) => go(year, Number(e.target.value), 0)} className={selectCls} aria-label={labels.month}>
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <div className="flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-xl border border-(--border-default) bg-(--bg-surface) p-0.5" role="radiogroup">
          {kinds.map((k) => (
            <button
              key={k.v}
              type="button"
              role="radio"
              aria-checked={kind === k.v}
              onClick={() => go(year, month, day, k.v)}
              className={cn("min-h-0 shrink-0 whitespace-nowrap rounded-[10px] px-3 py-2 text-xs font-black transition-all", kind === k.v ? "bg-gradient-brand text-(--brand-contrast) shadow" : "text-(--text-secondary) hover:text-(--text-primary)")}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Day strip ── */}
      <div ref={stripRef} className="-mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          data-active={day === 0}
          onClick={() => go(year, month, 0)}
          className={cn("flex h-14 min-h-0 min-w-14 shrink-0 flex-col items-center justify-center rounded-xl border px-3 lg:[@media(max-height:820px)]:h-11 text-[12px] font-black transition-all", day === 0 ? "border-transparent bg-gradient-brand text-(--brand-contrast) shadow-[0_8px_20px_-8px_var(--brand-500)]" : "border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)")}
        >
          {labels.all}
          <span className="text-[10px] font-bold opacity-70 tabular-nums">{stats.dayCount.reduce((a, b) => a + b, 0)}</span>
        </button>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const active = day === d;
          const dt = new Date(year, month - 1, d);
          const isToday = dt.toDateString() === now.toDateString();
          const future = dt.getTime() > now.getTime();
          const v = stats.series[d - 1] ?? 0;
          return (
            <button
              key={d}
              type="button"
              data-active={active}
              disabled={future}
              onClick={() => go(year, month, active ? 0 : d)}
              className={cn(
                "relative flex h-14 min-h-0 w-12 shrink-0 flex-col lg:[@media(max-height:820px)]:h-11 items-center justify-center overflow-hidden rounded-xl border text-center transition-all disabled:opacity-30",
                active ? "border-transparent bg-gradient-brand text-(--brand-contrast) shadow-[0_8px_20px_-8px_var(--brand-500)]" : isToday ? "border-(--brand-500) bg-(--gold-wash)" : "border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)",
                !active && v === 0 && !future && "opacity-60"
              )}
            >
              <span className="text-[9.5px] font-bold opacity-70 lg:[@media(max-height:820px)]:hidden">{new Intl.DateTimeFormat(loc, { weekday: "short" }).format(dt)}</span>
              <span className="text-[14px] font-black leading-none tabular-nums">{d}</span>
              <span aria-hidden className={cn("absolute inset-x-0 bottom-0 h-[3px]", active ? "bg-(--brand-contrast)/40" : "bg-(--brand-500)/60")} style={{ transform: `scaleX(${v / maxDay})`, transformOrigin: "left" }} />
            </button>
          );
        })}
      </div>

      {/* ── Van rail + payment filter ── */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setFVan("")}
            className={cn("flex min-h-0 shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-black transition-all", fVan === "" ? "border-(--brand-500) bg-(--brand-500)/12 text-(--gold-text)" : "border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) hover:border-(--brand-500)")}
          >
            <Store size={13} />{labels.allVans}
            <span className="rounded-full bg-(--bg-sunken) px-1.5 tabular-nums">{stats.range.count}</span>
          </button>
          {vans.map((v) => {
            const active = fVan === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setFVan(active ? "" : v.id)}
                className={cn("flex min-h-0 shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-black transition-all", active ? "border-(--brand-500) bg-(--brand-500)/12 text-(--gold-text)" : "border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) hover:border-(--brand-500)", v.count === 0 && !active && "opacity-50")}
              >
                {v.kind === "VAN" ? <Bus size={13} /> : <Store size={13} />}
                <span className="max-w-32 truncate" title={v.name}>{v.name}</span>
                <span className="rounded-full bg-(--bg-sunken) px-1.5 tabular-nums">{v.count}</span>
              </button>
            );
          })}
        </div>
        <div className="hidden shrink-0 gap-0.5 rounded-xl border border-(--border-default) bg-(--bg-surface) p-0.5 md:flex" role="radiogroup">
          {pays.map((p) => (
            <button key={p.v} type="button" role="radio" aria-checked={fPay === p.v} onClick={() => setFPay(p.v)} className={cn("flex min-h-0 items-center gap-1 whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-[11px] font-black transition-all", fPay === p.v ? "bg-(--bg-overlay) text-(--text-primary) shadow-sm" : "text-(--text-secondary) hover:text-(--text-primary)")}>
              {p.Icon && <p.Icon size={12} />}{p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── List + detail ── */}
      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        {/* list */}
        <div className="flex max-h-[72vh] min-w-0 flex-col overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) lg:h-full lg:max-h-none lg:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-(--border-default) bg-[linear-gradient(180deg,var(--gold-wash),transparent)] px-3 py-2 text-[11px] font-black">
            <span className="text-(--text-secondary)"><b className="tabular-nums text-(--text-primary)">{visible.length}</b> {labels.invoicesWord}</span>
            <span className="tabular-nums" dir="ltr">{dzMoney(Math.round(sum.total))}</span>
            <span className={cn("tabular-nums", sum.due > 0.005 ? "text-(--semantic-danger)" : "text-(--semantic-success)")} dir="ltr">{labels.due}: {dzMoney(Math.round(Math.max(0, sum.due)))}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
            {visible.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-sm font-bold text-(--text-tertiary)">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-(--bg-sunken)"><ReceiptText size={22} /></span>
                {labels.noMatch}
                {filtersOn && (
                  <button type="button" onClick={() => { setQ(""); setFVan(""); setFPay("all"); }} className="min-h-0 rounded-lg border border-(--border-default) px-3 py-1.5 text-xs font-black text-(--gold-text) hover:border-(--brand-500)">{labels.clearFilters}</button>
                )}
              </div>
            )}
            {groups.map((g) => (
              <section key={g.date.getTime()}>
                <div className="sticky top-0 z-[1] -mx-2 mb-1.5 flex items-center justify-between gap-2 bg-(--bg-overlay)/92 px-4 py-1.5 text-[11px] font-black backdrop-blur">
                  <span className="text-(--text-secondary)">{dayLabel(g.date)}</span>
                  <span className="flex items-center gap-2 text-(--text-tertiary)"><span className="tabular-nums">{g.rows.length}</span><span className="tabular-nums text-(--text-primary)" dir="ltr">{dzMoney(Math.round(g.total))}</span></span>
                </div>
                <div className="space-y-1.5 pb-2">
                  {g.rows.map((r, idx) => {
                    const total = Number(r.total);
                    const paid = Number(r.paid ?? 0);
                    const due = total - paid;
                    const active = r.id === selectedId;
                    const name = r.client?.name ?? labels.walkin;
                    const ratio = total > 0 ? Math.min(1, paid / total) : 1;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void select(r.id)}
                        style={{ animationDelay: `${Math.min(idx, 10) * 25}ms` }}
                        className={cn(
                          "relative w-full min-h-0 overflow-hidden rounded-xl border p-2.5 text-start transition-all duration-200",
                          active
                            ? "border-(--brand-500) bg-[linear-gradient(135deg,var(--gold-wash),var(--bg-overlay)_80%)] shadow-[0_10px_26px_-14px_var(--brand-500)]"
                            : "border-(--border-default) bg-(--bg-overlay) hover:-translate-y-px hover:border-(--border-strong) hover:bg-(--bg-surface)"
                        )}
                      >
                        {active && <span aria-hidden className="absolute inset-y-2 start-0 w-1 rounded-e-full bg-gradient-brand" />}
                        <div className="flex items-center gap-2.5">
                          <Avatar name={name} size="sm" walkin={!r.client} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 flex-1 text-[13px] font-black"><ClientName name={r.client?.name} fallback={labels.walkin} lat={r.client?.gpsLat} lng={r.client?.gpsLng} /></span>
                              <span className="shrink-0 text-[13px] font-black tabular-nums" dir="ltr">{dzMoney(total)}</span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[10.5px] font-bold text-(--text-tertiary)">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="shrink-0 font-mono" dir="ltr">{r.number}</span>
                                <span className="flex min-w-0 items-center gap-0.5 truncate">{r.location?.kind === "VAN" ? <Bus size={10} className="shrink-0" /> : <Store size={10} className="shrink-0" />}<span className="truncate">{r.location?.name ?? ""}</span></span>
                                <span className="shrink-0" dir="ltr">{timeFmt.format(new Date(r.date as string))}</span>
                              </span>
                              {due > 0.005 ? (
                                <span className="shrink-0 font-black tabular-nums text-(--semantic-danger)" dir="ltr">−{dzMoney(due)}</span>
                              ) : (
                                <span className="flex shrink-0 items-center gap-0.5 font-black text-(--semantic-success)"><Check size={12} strokeWidth={3} /></span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className={cn("shrink-0 rounded-full px-2 py-px text-[9.5px] font-black", STATUS_STYLE[r.status] ?? STATUS_STYLE.DRAFT)}>{statusLabel(r.status)}</span>
                          {r.kind && <span className="shrink-0 rounded-full bg-(--bg-sunken) px-2 py-px text-[9.5px] font-black text-(--text-secondary)">{kindLabel(r.kind)}</span>}
                          {unsynced.has(r.id) && (
                            <span className="pill-amber flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[9.5px] font-black"><WifiOff size={10} />{labels.unsynced ?? "…"}</span>
                          )}
                          <div className="ms-1 h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-(--bg-sunken)">
                            <div className={cn("h-full rounded-full", ratio >= 1 ? "bg-emerald-500" : ratio > 0 ? "bg-amber-500" : "bg-red-500/60")} style={{ width: `${Math.max(ratio * 100, 6)}%` }} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* detail: panel on desktop, full-screen sheet on phones/tablets */}
        <div
          className={cn(
            "min-w-0 lg:static lg:z-auto lg:h-full lg:min-h-0 lg:overflow-y-auto lg:bg-transparent lg:p-0 lg:pb-2 lg:pe-0.5",
            sheetOpen
              ? "fixed inset-0 z-50 overflow-y-auto bg-(--bg-page) p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
              : "hidden lg:block"
          )}
        >
          {sheetOpen && (
            <button
              type="button"
              onClick={() => { setSelectedId(null); setDetail(null); }}
              className="mb-3 flex min-h-11 items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-3 text-sm font-black text-(--text-primary) lg:hidden"
            >
              {locale === "ar" ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
              {labels.back}
            </button>
          )}
          <div className="space-y-3 lg:h-full">
            {detailLoading && !detail ? (
              <div className="space-y-3">
                <div className="h-44 animate-pulse rounded-2xl bg-(--bg-sunken)" />
                <div className="h-64 animate-pulse rounded-2xl bg-(--bg-sunken)" />
              </div>
            ) : detail ? (
              <SaleActions
                locale={locale}
                sale={detail}
                locations={formData.locations.map((l: { id: string; name: string; kind?: string; noStock?: boolean }) => ({ id: l.id, name: l.name, kind: l.kind, noStock: l.noStock }))}
                labels={detailLabels}
                onDone={(id) => void detailChanged(id)}
                formData={formData}
                formLabels={formLabels}
                canEdit
              />
            ) : (
              <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-(--border-strong) bg-[radial-gradient(circle_at_50%_0%,var(--gold-wash),transparent_70%)] p-10 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-brand text-(--brand-contrast) shadow-[0_14px_30px_-12px_var(--brand-500)]"><ReceiptText size={28} /></span>
                <p className="max-w-xs text-sm font-black text-(--text-secondary)">{labels.selectInvoice}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={labels.newTicket} subtitle={labels.title} icon="+" width="xl">
        {modal && (
          <SaleDocForm
            key={modal}
            locale={locale}
            mode="ticket"
            clients={formData.clients}
            products={formData.products}
            units={formData.units}
            tiers={formData.tiers}
            locations={formData.locations}
            remiseEnabled={formData.settings.remiseEnabled}
            creditEnabled={formData.settings.creditSalesEnabled}
            allowPieces={formData.settings.pieceSalesEnabled}
            defaultTierId={formData.tiers[0]?.id}
            onCreated={created}
            labels={formLabels}
          />
        )}
      </Modal>
    </div>
  );
}
