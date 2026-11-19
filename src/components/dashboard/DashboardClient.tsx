"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle, ArrowDownRight, ArrowLeftRight, ArrowUpRight, BarChart3, Boxes, CalendarDays, CalendarRange,
  ChevronDown, Coins, NotebookPen, Percent, PiggyBank, Receipt, RefreshCw, ShoppingCart, Store, Sun, Truck,
  Users, Wallet, Crown, Package, Trophy, Wallet2, type LucideIcon,
} from "lucide-react";
import { dz, dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Agg, DashboardData, Period } from "@/lib/dashboard/stats";
import { Donut, MiniBars, TrendChart, compactNum, useCountUp } from "./charts";

const ICONS: Record<string, LucideIcon> = { Store, ShoppingCart, Users, Boxes, ArrowLeftRight, Wallet, NotebookPen, BarChart3 };

export type DashAction = { href: string; label: string; icon: string; cls: string };
export type DashExtras = {
  clientDebt: number;
  supplierDebt: number;
  lowCount: number;
  lowList: Array<{ name: string; qty: number; min: number }>;
};

const PERIODS: Period[] = ["day", "week", "month"];
const PERIOD_ICON: Record<Period, LucideIcon> = { day: Sun, week: CalendarDays, month: CalendarRange };

function Money({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={cn("tabular-nums", className)}>{dzMoney(Math.round(v))}</span>;
}

function pctDelta(cur: number, prev: number): number | null {
  if (prev <= 0) return cur > 0 ? null : 0;
  return ((cur - prev) / prev) * 100;
}

function Delta({ cur, prev, className }: { cur: number; prev: number; className?: string }) {
  const d = pctDelta(cur, prev);
  if (cur === 0 && prev === 0) return <span className={cn("rounded-full bg-(--bg-sunken) px-2 py-0.5 text-[10px] font-black text-(--text-tertiary)", className)}>—</span>;
  if (d === null) return <span className={cn("rounded-full bg-(--bg-sunken) px-2 py-0.5 text-[10px] font-black text-(--text-tertiary)", className)}>NEW</span>;
  const up = d >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums",
        up ? "bg-emerald-500/15 text-(--semantic-success)" : "bg-red-500/15 text-(--semantic-danger)",
        className
      )}
    >
      <Icon size={12} strokeWidth={3} />
      {Math.abs(d) >= 1000 ? ">999" : Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}%
    </span>
  );
}

const MEDAL = [
  "bg-gradient-to-br from-[#fbe38a] to-[#c9951a] text-[#2a1b00]",
  "bg-gradient-to-br from-[#e9e9ef] to-[#9d9dab] text-[#1d1d24]",
  "bg-gradient-to-br from-[#efb78a] to-[#a8683a] text-[#2b1304]",
];
function Rank({ i }: { i: number }) {
  return (
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black", MEDAL[i] ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
      {i === 0 ? <Crown size={12} /> : i + 1}
    </span>
  );
}

function Panel({ title, icon: Icon, right, children, className }: { title: string; icon?: LucideIcon; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4", className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-black">
          {Icon && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--gold-wash) text-(--gold-text)">
              <Icon size={15} />
            </span>
          )}
          <span className="truncate">{title}</span>
        </h2>
        {right}
      </header>
      {children}
    </section>
  );
}

function Seg<T extends string>({ value, onChange, options, small }: { value: T; onChange: (v: T) => void; options: Array<{ v: T; label: string }>; small?: boolean }) {
  return (
    <div className="inline-flex rounded-xl border border-(--border-default) bg-(--bg-surface) p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "rounded-[10px] font-black transition-all",
            small ? "min-h-0 px-2.5 py-1 text-[11px]" : "min-h-0 px-3.5 py-1.5 text-xs",
            value === o.v ? "bg-gradient-brand text-(--brand-contrast) shadow" : "text-(--text-secondary) hover:text-(--text-primary)"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-(--bg-sunken)">
      <div className={cn("gw-grow-x h-full rounded-full bg-gradient-to-r from-(--brand-600) to-(--brand-300)", className)} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function DashboardClient({ data, locale, userName, extras, actions }: { data: DashboardData; locale: string; userName: string; extras: DashExtras; actions: DashAction[] }) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [period, setPeriod] = React.useState<Period>("day");
  const [prodMetric, setProdMetric] = React.useState<"revenue" | "profit" | "qty">("revenue");
  const [openVan, setOpenVan] = React.useState<string | null>(data.vans.find((v) => v.periods.month.revenue > 0)?.id ?? data.vans[0]?.id ?? null);
  const [refreshing, startRefresh] = React.useTransition();
  const money = dzMoney;
  const label = (p: Period) => (p === "day" ? t("day") : p === "week" ? t("week") : t("month"));
  const vsLabel = (p: Period) => (p === "day" ? t("vsDay") : p === "week" ? t("vsWeek") : t("vsMonth"));

  // Live data: refresh every 2 minutes while the tab is visible.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") startRefresh(() => router.refresh());
    }, 120_000);
    return () => window.clearInterval(id);
  }, [router]);

  const nf = React.useMemo(() => new Intl.DateTimeFormat(`${locale === "ar" ? "ar-DZ" : locale}-u-nu-latn`, { day: "numeric", month: "short" }), [locale]);
  const longDate = React.useMemo(() => new Intl.DateTimeFormat(`${locale === "ar" ? "ar-DZ" : locale}-u-nu-latn`, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(data.nowIso)), [locale, data.nowIso]);
  const timeFmt = React.useMemo(() => new Intl.DateTimeFormat(`${locale === "ar" ? "ar-DZ" : locale}-u-nu-latn`, { hour: "2-digit", minute: "2-digit", hour12: false }), [locale]);

  const cur = data.periods[period].cur;
  const prev = data.periods[period].prev;
  const net = cur.profit - cur.expenses;
  const marginPct = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : 0;
  const avg = cur.count > 0 ? cur.revenue / cur.count : 0;
  const collectedPct = cur.revenue > 0 ? Math.min(100, (cur.paid / cur.revenue) * 100) : 0;

  const trend = data.trend.map((d) => {
    const [y, m, dd] = d.date.split("-").map(Number);
    return { label: nf.format(new Date(y, m - 1, dd)), revenue: d.revenue, profit: d.profit };
  });

  const ch = data.channels[period];
  const chTotal = ch.VAN + ch.DEPOT + ch.POS;
  const segs = [
    { label: t("chVan"), value: ch.VAN, color: "var(--brand-500)" },
    { label: t("chDepot"), value: ch.DEPOT, color: "#4cc38a" },
    { label: t("chPos"), value: ch.POS, color: "#e07a3a" },
  ];

  const top = data.top[period];
  const products = [...top.products].sort((a, b) => b[prodMetric] - a[prodMetric]).slice(0, 6);
  const prodMax = Math.max(1, ...products.map((p) => p[prodMetric]));
  const vans = top.vans.slice(0, 6);
  const vanMax = Math.max(1, ...vans.map((v) => v.revenue));
  const clients = top.clients.slice(0, 6);
  const cliMax = Math.max(1, ...clients.map((c) => c.revenue));

  const sum = (p: Period) => ({
    revenue: data.vans.reduce((s, v) => s + v.periods[p].revenue, 0) + data.other[p].revenue,
    profit: data.vans.reduce((s, v) => s + v.periods[p].profit, 0) + data.other[p].profit,
  });

  const empty = <div className="flex flex-1 items-center justify-center py-8 text-xs font-bold text-(--text-tertiary)">{t("noSales")}</div>;
  const qty = (n: number) => dz(Math.round(n * 100) / 100, 2);

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4 p-4 sm:p-5 md:p-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black tracking-tight sm:text-2xl">
            {t("hello")} <span className="text-(--gold-text)">{userName}</span>
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-bold text-(--text-secondary)">
            <span className="flex items-center gap-1.5"><i className="gw-live inline-block h-2 w-2 rounded-full bg-(--semantic-success)" />{longDate}</span>
            <span className="hidden text-(--text-tertiary) sm:inline">· {t("overview")}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Seg value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ v: p, label: label(p) }))} />
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            aria-label={t("refresh")}
            title={`${t("updated")} ${timeFmt.format(new Date(data.nowIso))}`}
            className="flex h-9 min-h-0 w-9 min-w-0 items-center justify-center rounded-xl border border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) hover:border-(--brand-500) hover:text-(--gold-text)"
          >
            <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Day / Week / Month: revenue + profit ── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PERIODS.map((p) => {
          const a = data.periods[p].cur;
          const b = data.periods[p].prev;
          const Icon = PERIOD_ICON[p];
          const mg = a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0;
          const active = p === period;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={active}
              className={cn(
                "group relative min-h-0 overflow-hidden rounded-2xl border p-4 text-start transition-all duration-300 hover:-translate-y-0.5",
                active
                  ? "border-(--brand-500) bg-[linear-gradient(135deg,var(--gold-wash),var(--bg-overlay)_70%)] shadow-[0_18px_40px_-18px_var(--brand-500)]"
                  : "border-(--border-default) bg-(--bg-overlay) hover:border-(--border-strong)"
              )}
            >
              <span aria-hidden className={cn("pointer-events-none absolute -end-10 -top-10 h-32 w-32 rounded-full bg-(--brand-500) blur-3xl transition-opacity duration-500", active ? "opacity-25" : "opacity-0 group-hover:opacity-10")} />
              <div className="relative flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-black text-(--text-secondary)">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", active ? "bg-gradient-brand text-(--brand-contrast)" : "bg-(--bg-sunken) text-(--gold-text)")}>
                    <Icon size={16} />
                  </span>
                  {label(p)}
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <Delta cur={a.revenue} prev={b.revenue} />
                  <span className="text-[9px] font-bold text-(--text-tertiary)">{vsLabel(p)}</span>
                </span>
              </div>
              <div className="relative mt-3">
                <div className="text-[11px] font-bold text-(--text-tertiary)">{t("revenue")}</div>
                <Money value={a.revenue} className="block whitespace-nowrap text-[clamp(22px,2.6vw,34px)] font-black leading-tight tracking-tight" />
              </div>
              <div className="relative mt-3 flex items-end justify-between gap-2 border-t border-(--border-default) pt-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-(--text-tertiary)">{t("profit")}</div>
                  <Money value={a.profit} className={cn("block whitespace-nowrap text-[clamp(16px,1.7vw,22px)] font-black leading-tight", a.profit >= 0 ? "text-(--semantic-success)" : "text-(--semantic-danger)")} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Delta cur={a.profit} prev={b.profit} />
                  <span className="text-[10px] font-black text-(--text-secondary)" dir="ltr">{mg.toFixed(0)}% · {a.count} {t("inv")}</span>
                </div>
              </div>
              <div className="relative mt-2.5"><Bar pct={mg} className="from-emerald-600 to-emerald-300" /></div>
            </button>
          );
        })}
      </div>

      {/* ── Secondary KPIs for the selected period ── */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 2xl:grid-cols-6">
        {[
          { l: t("orders"), v: dz(cur.count, 0), icon: Receipt, c: "bg-sky-500/15 text-sky-600", sub: <Delta cur={cur.count} prev={prev.count} /> },
          { l: t("avgBasket"), v: money(Math.round(avg)), icon: ShoppingCart, c: "bg-emerald-500/15 text-emerald-600", sub: null },
          { l: t("marginPct"), v: `${marginPct.toFixed(1)}%`, icon: Percent, c: "bg-(--brand-500)/15 text-(--gold-text)", sub: null },
          { l: t("collected"), v: money(Math.round(cur.paid)), icon: Wallet2, c: "bg-teal-500/15 text-teal-600", sub: <span className="text-[10px] font-black text-(--text-tertiary)" dir="ltr">{collectedPct.toFixed(0)}%</span> },
          { l: t("expenses"), v: money(Math.round(cur.expenses)), icon: Wallet, c: "bg-orange-500/15 text-orange-500", sub: null },
          { l: t("netProfit"), v: money(Math.round(net)), icon: PiggyBank, c: net >= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-500", sub: null },
        ].map((k) => (
          <div key={k.l} className="group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-(--border-strong)">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", k.c)}>
              <k.icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-[11px] font-bold text-(--text-tertiary)">{k.l}</span>
                {k.sub}
              </div>
              <div className="truncate text-[clamp(14px,1.25vw,18px)] font-black leading-tight tabular-nums">{k.v}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Trend + channels ── */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          title={t("trendTitle")}
          icon={BarChart3}
          right={
            <div className="flex items-center gap-3 text-[11px] font-black text-(--text-secondary)">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-(--brand-500)" />{t("revenue")}</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-(--semantic-success)" />{t("profit")}</span>
            </div>
          }
        >
          <TrendChart data={trend} revenueLabel={t("revenue")} profitLabel={t("profit")} money={money} />
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          <Panel title={`${t("channelMix")} · ${label(period)}`} icon={Store}>
            {chTotal <= 0 ? (
              empty
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-5">
                <Donut
                  segs={segs}
                  center={
                    <>
                      <span className="text-[10px] font-bold text-(--text-tertiary)">{t("revenue")}</span>
                      <span className="text-sm font-black tabular-nums" dir="ltr">{compactNum(chTotal)}</span>
                    </>
                  }
                />
                <ul className="min-w-0 flex-1 space-y-2 text-xs font-bold" style={{ minWidth: 140 }}>
                  {segs.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.label}</span></span>
                      <span className="tabular-nums text-(--text-secondary)" dir="ltr">{chTotal > 0 ? Math.round((s.value / chTotal) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title={t("alerts")} icon={AlertTriangle}>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-red-500/10 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-(--text-secondary)"><Users size={12} />{t("clientsOwe")}</div>
                <div className="mt-0.5 truncate text-sm font-black tabular-nums text-(--semantic-danger)">{money(extras.clientDebt)}</div>
              </div>
              <div className="rounded-xl bg-orange-500/10 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-(--text-secondary)"><Truck size={12} />{t("weOwe")}</div>
                <div className="mt-0.5 truncate text-sm font-black tabular-nums text-orange-500">{money(extras.supplierDebt)}</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] font-black text-(--text-tertiary)">{t("lowStockList")} ({extras.lowCount})</div>
            {extras.lowList.length === 0 ? (
              <div className="mt-1 text-xs font-bold text-(--semantic-success)">✓ {t("allGood")}</div>
            ) : (
              <ul className="mt-1 space-y-1">
                {extras.lowList.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-2 text-xs font-bold">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-black tabular-nums text-amber-600" dir="ltr">{qty(p.qty)} / {qty(p.min)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* ── Rankings ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel
          title={t("topProducts")}
          icon={Package}
          right={<Seg small value={prodMetric} onChange={setProdMetric} options={[{ v: "revenue", label: t("byRevenue") }, { v: "profit", label: t("byProfit") }, { v: "qty", label: t("byQty") }]} />}
        >
          {products.length === 0 ? empty : (
            <ul className="space-y-3">
              {products.map((p, i) => (
                <li key={p.id} className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Rank i={i} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-black">{p.name}</span>
                    <span className="shrink-0 text-[13px] font-black tabular-nums">{prodMetric === "qty" ? qty(p.qty) : money(Math.round(p[prodMetric]))}</span>
                  </div>
                  <Bar pct={(p[prodMetric] / prodMax) * 100} className={prodMetric === "profit" ? "from-emerald-600 to-emerald-300" : undefined} />
                  <div className="mt-1 flex justify-between text-[10.5px] font-bold text-(--text-tertiary)">
                    <span>{qty(p.qty)} {t("units")}</span>
                    <span className="text-(--semantic-success)">{t("profit")}: {money(Math.round(p.profit))}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`${t("topVans")} · ${label(period)}`} icon={Truck}>
          {vans.length === 0 ? empty : (
            <ul className="space-y-3">
              {vans.map((v, i) => (
                <li key={v.id} className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Rank i={i} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-black">{v.name}{v.matricule && <span className="ms-1.5 text-[10px] font-bold text-(--text-tertiary)" dir="ltr">{v.matricule}</span>}</span>
                    <span className="shrink-0 text-[13px] font-black tabular-nums">{money(Math.round(v.revenue))}</span>
                  </div>
                  <Bar pct={(v.revenue / vanMax) * 100} />
                  <div className="mt-1 flex justify-between text-[10.5px] font-bold text-(--text-tertiary)">
                    <span>{v.count} {t("inv")}</span>
                    <span className="text-(--semantic-success)">{t("profit")}: {money(Math.round(v.profit))}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`${t("topClients")} · ${label(period)}`} icon={Trophy} className="md:col-span-2 xl:col-span-1">
          {clients.length === 0 ? empty : (
            <ul className="space-y-3">
              {clients.map((c, i) => (
                <li key={c.id} className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Rank i={i} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-black">{c.name}</span>
                    <span className="shrink-0 text-[13px] font-black tabular-nums">{money(Math.round(c.revenue))}</span>
                  </div>
                  <Bar pct={(c.revenue / cliMax) * 100} />
                  <div className="mt-1 flex justify-between text-[10.5px] font-bold text-(--text-tertiary)">
                    <span>{c.count} {t("inv")}</span>
                    <span className="text-(--semantic-success)">{t("profit")}: {money(Math.round(c.profit))}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Per-van performance (day / week / month) + latest sales ── */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-8" title={t("vansPerf")} icon={Truck} right={<span className="hidden text-[11px] font-bold text-(--text-tertiary) sm:block">{t("vansPerfHint")}</span>}>
          {data.vans.length === 0 ? (
            <div className="py-8 text-center text-xs font-bold text-(--text-tertiary)">{t("noVans")}</div>
          ) : (
            <div className="space-y-2">
              {/* column heads (≥ md) */}
              <div className="hidden grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,1fr))_28px] gap-3 px-3 text-[11px] font-black text-(--text-tertiary) md:grid">
                <span>{t("van")}</span>
                {PERIODS.map((p) => <span key={p} className="text-end">{label(p)} · {t("revenue")} / {t("profit")}</span>)}
                <span />
              </div>
              {data.vans.map((v) => {
                const open = openVan === v.id;
                const share = sum("month").revenue > 0 ? (v.periods.month.revenue / sum("month").revenue) * 100 : 0;
                return (
                  <div key={v.id} className={cn("overflow-hidden rounded-xl border transition-all duration-300", open ? "border-(--brand-500) bg-(--bg-surface) shadow-[0_14px_34px_-20px_var(--brand-500)]" : "border-(--border-default) hover:border-(--border-strong)")}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenVan(open ? null : v.id)}
                      className="grid min-h-0 w-full grid-cols-1 items-center gap-2 px-3 py-2.5 text-start md:grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,1fr))_28px] md:gap-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--gold-wash) text-(--gold-text)"><Truck size={17} /></span>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-black">{v.name}</div>
                          <div className="truncate text-[10.5px] font-bold text-(--text-tertiary)">{[v.driver, v.matricule].filter(Boolean).join(" · ") || "—"}</div>
                        </div>
                        <ChevronDown size={16} className={cn("ms-auto shrink-0 text-(--text-tertiary) transition-transform duration-300 md:hidden", open && "rotate-180")} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 md:contents">
                        {PERIODS.map((p) => (
                          <div key={p} className="min-w-0 rounded-lg bg-(--bg-sunken) px-2 py-1.5 md:bg-transparent md:p-0 md:text-end">
                            <div className="text-[9.5px] font-black text-(--text-tertiary) md:hidden">{label(p)}</div>
                            <div className="truncate text-[12.5px] font-black tabular-nums">{money(Math.round(v.periods[p].revenue))}</div>
                            <div className={cn("truncate text-[11px] font-black tabular-nums", v.periods[p].profit >= 0 ? "text-(--semantic-success)" : "text-(--semantic-danger)")}>{money(Math.round(v.periods[p].profit))}</div>
                          </div>
                        ))}
                      </div>
                      <ChevronDown size={16} className={cn("hidden shrink-0 text-(--text-tertiary) transition-transform duration-300 md:block", open && "rotate-180")} />
                    </button>
                    {open && (
                      <div className="grid gap-4 border-t border-(--border-default) p-3 md:p-4 lg:grid-cols-12" style={{ animation: "gw-fade 0.35s ease" }}>
                        <div className="grid grid-cols-3 gap-2 lg:col-span-12">
                          {PERIODS.map((p) => {
                            const a: Agg = v.periods[p];
                            return (
                              <div key={p} className="min-w-0 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5 sm:p-3">
                                <div className="mb-1 flex items-center justify-between gap-1 text-[11px] font-black text-(--text-secondary)">
                                  <span>{label(p)}</span>
                                  <span className="text-(--text-tertiary)">{a.count} {t("inv")}</span>
                                </div>
                                <div className="truncate text-[clamp(13px,1.5vw,19px)] font-black tabular-nums">{money(Math.round(a.revenue))}</div>
                                <div className="text-[9.5px] font-bold text-(--text-tertiary)">{t("revenue")}</div>
                                <div className={cn("mt-1.5 truncate text-[clamp(12px,1.2vw,15px)] font-black tabular-nums", a.profit >= 0 ? "text-(--semantic-success)" : "text-(--semantic-danger)")}>{money(Math.round(a.profit))}</div>
                                <div className="text-[9.5px] font-bold text-(--text-tertiary)">{t("profit")}{a.expenses > 0 && ` · ${t("expenses")} ${money(Math.round(a.expenses))}`}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="min-w-0 lg:col-span-4">
                          <div className="mb-2 flex items-center justify-between text-[11px] font-black text-(--text-secondary)">
                            <span>{t("last14")}</span>
                            <span className="text-(--text-tertiary)" dir="ltr">{share.toFixed(0)}% · {t("share")}</span>
                          </div>
                          <MiniBars values={v.trend.map((x) => x.r)} height={92} />
                        </div>
                        <div className="min-w-0 lg:col-span-4">
                          <div className="mb-2 text-[11px] font-black text-(--text-secondary)">{t("bestProducts")} · {label(period)}</div>
                          {v.periods[period].products.length === 0 ? (
                            <div className="text-xs font-bold text-(--text-tertiary)">{t("noSales")}</div>
                          ) : (
                            <ul className="space-y-1.5">
                              {v.periods[period].products.slice(0, 5).map((p, i) => (
                                <li key={p.id} className="flex items-center gap-2 text-xs font-bold">
                                  <Rank i={i} />
                                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                  <span className="shrink-0 tabular-nums text-(--text-secondary)" dir="ltr">{qty(p.qty)}</span>
                                  <span className="w-20 shrink-0 text-end font-black tabular-nums">{compactNum(p.revenue)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="min-w-0 lg:col-span-4">
                          <div className="mb-2 text-[11px] font-black text-(--text-secondary)">{t("bestClients")} · {label(period)}</div>
                          {v.periods[period].clients.length === 0 ? (
                            <div className="text-xs font-bold text-(--text-tertiary)">{t("noSales")}</div>
                          ) : (
                            <ul className="space-y-1.5">
                              {v.periods[period].clients.slice(0, 5).map((c, i) => (
                                <li key={c.id} className="flex items-center gap-2 text-xs font-bold">
                                  <Rank i={i} />
                                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                  <span className="w-20 shrink-0 text-end font-black tabular-nums">{compactNum(c.revenue)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* non-van sales + grand total (reconciles with the cards above) */}
              <div className="grid grid-cols-1 items-center gap-2 rounded-xl border border-dashed border-(--border-default) px-3 py-2.5 md:grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,1fr))_28px] md:gap-3">
                <div className="flex items-center gap-2.5 text-[13px] font-black text-(--text-secondary)"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-(--bg-sunken)"><Store size={16} /></span>{t("otherSales")}</div>
                <div className="grid grid-cols-3 gap-2 md:contents">
                  {PERIODS.map((p) => (
                    <div key={p} className="min-w-0 md:text-end">
                      <div className="truncate text-[12.5px] font-black tabular-nums text-(--text-secondary)">{money(Math.round(data.other[p].revenue))}</div>
                      <div className="truncate text-[11px] font-black tabular-nums text-(--text-tertiary)">{money(Math.round(data.other[p].profit))}</div>
                    </div>
                  ))}
                </div>
                <span />
              </div>
            </div>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <Panel title={t("recentSales")} icon={Coins} className="flex-1">
            {data.recent.length === 0 ? empty : (
              <ul className="divide-y divide-(--border-subtle)">
                {data.recent.map((s) => (
                  <li key={s.id} className="flex items-center gap-2.5 py-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--gold-wash) text-(--gold-text)"><Receipt size={14} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-black">{s.client || t("walkIn")}</div>
                      <div className="truncate text-[10.5px] font-bold text-(--text-tertiary)" dir="auto">{[s.van, s.number].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="shrink-0 text-end">
                      <div className="text-xs font-black tabular-nums">{money(s.total)}</div>
                      <div className="text-[10px] font-bold text-(--text-tertiary)" dir="auto">{nf.format(new Date(s.dateIso))} · {timeFmt.format(new Date(s.dateIso))}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* ── Shortcuts ── */}
      {actions.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {actions.map((a) => {
            const Icon = ICONS[a.icon] ?? Store;
            return (
              <Link
                key={a.href}
                href={`/${locale}/${a.href}`}
                className="dash-lift flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5 text-center hover:border-(--brand-500)"
              >
                <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", a.cls)}><Icon size={18} /></span>
                <span className="w-full truncate text-[11px] font-black leading-tight">{a.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
