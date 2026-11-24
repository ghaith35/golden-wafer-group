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
import { MiniBars, TrendChart, compactNum, useCountUp } from "./charts";
import { ClientName } from "@/components/clients/ClientName";

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
function Rank({ i, small }: { i: number; small?: boolean }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full font-black", small ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]", MEDAL[i] ?? "bg-(--bg-sunken) text-(--text-secondary)")}>
      {i === 0 ? <Crown size={12} /> : i + 1}
    </span>
  );
}

function Panel({ title, icon: Icon, right, children, className, fit }: { title: string; icon?: LucideIcon; right?: React.ReactNode; children: React.ReactNode; className?: string; fit?: boolean }) {
  return (
    <section className={cn("relative flex min-w-0 flex-col rounded-2xl border border-(--border-default) bg-(--bg-overlay)", fit ? "min-h-0 overflow-hidden p-3" : "p-4", className)}>
      <header className={cn("flex shrink-0 items-center justify-between gap-2", fit ? "mb-2" : "mb-3")}>
        <h2 className={cn("flex min-w-0 items-center gap-2 font-black", fit ? "text-[12.5px]" : "text-sm")}>
          {Icon && (
            <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-(--gold-wash) text-(--gold-text)", fit ? "h-6 w-6" : "h-7 w-7")}>
              <Icon size={fit ? 13 : 15} />
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
    <div className="inline-flex shrink-0 rounded-xl border border-(--border-default) bg-(--bg-surface) p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "whitespace-nowrap rounded-[10px] font-black transition-all",
            small ? "min-h-0 px-1.5 py-0.5 text-[10px] leading-tight" : "min-h-0 px-3.5 py-1.5 text-xs",
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


type RankItem = { id: string; name: string; client?: boolean; lat?: number | null; lng?: number | null; sub?: string; value: number; valueLabel: string; profit: number; count?: number; qtyLabel?: string };

function RankList({ items, max, fit, t, green }: { items: RankItem[]; max: number; fit: boolean; t: (k: string) => string; green?: boolean }) {
  const money = dzMoney;
  return (
    <ul className={cn("min-h-0 flex-1", fit ? "space-y-[6px] overflow-hidden" : "space-y-3")}>
      {items.map((it, i) => (
        <li key={it.id} className="min-w-0">
          <div className="flex items-center gap-2">
            <Rank i={i} small={fit} />
            <span className={cn("min-w-0 flex-1 line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight font-black", fit ? "text-[12px]" : "text-[13px]")}>
              {it.client ? <ClientName name={it.name} lat={it.lat} lng={it.lng} /> : it.name}
              {it.sub && <span className="ms-1.5 text-[10px] font-bold text-(--text-tertiary)" dir="ltr">{it.sub}</span>}
            </span>
            {fit && <span className="shrink-0 text-[10px] font-black tabular-nums text-(--semantic-success)">{compactNum(it.profit)}</span>}
            <span className={cn("shrink-0 text-end font-black tabular-nums", fit ? "min-w-[64px] text-[12px]" : "text-[13px]")}>{it.valueLabel}</span>
          </div>
          <div className="mt-1"><Bar pct={(it.value / max) * 100} className={green ? "from-emerald-600 to-emerald-300" : undefined} /></div>
          {!fit && (
            <div className="mt-1 flex justify-between text-[10.5px] font-bold text-(--text-tertiary)">
              <span>{it.qtyLabel ?? (it.count !== undefined ? `${it.count} ${t("inv")}` : "")}</span>
              <span className="text-(--semantic-success)">{t("profit")}: {money(Math.round(it.profit))}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DashboardClient({ data, locale, userName, extras, actions }: { data: DashboardData; locale: string; userName: string; extras: DashExtras; actions: DashAction[] }) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [period, setPeriod] = React.useState<Period>("day");
  const [prodMetric, setProdMetric] = React.useState<"revenue" | "profit" | "qty">("revenue");
  const [openVan, setOpenVan] = React.useState<string | null>(null);
  const [refreshing, startRefresh] = React.useTransition();
  const money = dzMoney;
  const label = (p: Period) => (p === "day" ? t("day") : p === "week" ? t("week") : t("month"));
  const vsLabel = (p: Period) => (p === "day" ? t("vsDay") : p === "week" ? t("vsWeek") : t("vsMonth"));

  // ── One-screen "stage": on desktop the whole dashboard is laid out on a
  // virtual canvas and CSS-zoomed to exactly fill the window (no page scroll,
  // everything shrinks together). Narrow windows / phones keep the stacked flow.
  const probeRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<{ w: number; h: number } | null>(null);
  React.useLayoutEffect(() => {
    const el = probeRef.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = !!box && box.w >= 740 && box.h >= 420;
  const scale = box ? Math.min(1.7, Math.max(0.55, Math.min(box.h / 860, box.w / 1400))) : 1;

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") startRefresh(() => router.refresh());
    }, 120_000);
    return () => window.clearInterval(id);
  }, [router]);

  const loc = `${locale === "ar" ? "ar-DZ" : locale}-u-nu-latn`;
  const nf = React.useMemo(() => new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }), [loc]);
  const longDate = React.useMemo(() => new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(data.nowIso)), [loc, data.nowIso]);
  const timeFmt = React.useMemo(() => new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false }), [loc]);

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

  const N = fit ? 5 : 6;
  const top = data.top[period];
  const products = [...top.products].sort((a, b) => b[prodMetric] - a[prodMetric]).slice(0, N);
  const prodMax = Math.max(1, ...products.map((p) => p[prodMetric]));
  const vans = top.vans.slice(0, N);
  const vanMax = Math.max(1, ...vans.map((v) => v.revenue));
  const clients = top.clients.slice(0, N);
  const cliMax = Math.max(1, ...clients.map((c) => c.revenue));
  const monthTotal = data.vans.reduce((s, v) => s + v.periods.month.revenue, 0) + data.other.month.revenue;

  const qty = (n: number) => dz(Math.round(n * 100) / 100, 2);
  const empty = <div className="flex flex-1 items-center justify-center py-4 text-xs font-bold text-(--text-tertiary)">{t("noSales")}</div>;

  const productItems: RankItem[] = products.map((p) => ({ id: p.id, name: p.name, value: p[prodMetric], valueLabel: prodMetric === "qty" ? qty(p.qty) : compactOrFull(p[prodMetric], fit), profit: p.profit, qtyLabel: `${qty(p.qty)} ${t("units")}` }));
  const vanItems: RankItem[] = vans.map((v) => ({ id: v.id, name: v.name, sub: v.matricule, value: v.revenue, valueLabel: compactOrFull(v.revenue, fit), profit: v.profit, count: v.count }));
  const clientItems: RankItem[] = clients.map((c) => ({ id: c.id, name: c.name, client: true, lat: c.gpsLat, lng: c.gpsLng, value: c.revenue, valueLabel: compactOrFull(c.revenue, fit), profit: c.profit, count: c.count }));

  /* ── reusable blocks ── */
  const periodCard = (p: Period) => {
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
          "group relative min-h-0 min-w-0 overflow-hidden rounded-2xl border text-start transition-all duration-300 hover:-translate-y-0.5",
          fit ? "p-3" : "p-4",
          active
            ? "border-(--brand-500) bg-[linear-gradient(135deg,var(--gold-wash),var(--bg-overlay)_70%)] shadow-[0_18px_40px_-18px_var(--brand-500)]"
            : "border-(--border-default) bg-(--bg-overlay) hover:border-(--border-strong)"
        )}
      >
        <span aria-hidden className={cn("pointer-events-none absolute -end-10 -top-10 h-32 w-32 rounded-full bg-(--brand-500) blur-3xl transition-opacity duration-500", active ? "opacity-25" : "opacity-0 group-hover:opacity-10")} />
        <div className="relative flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-black text-(--text-secondary)">
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", active ? "bg-gradient-brand text-(--brand-contrast)" : "bg-(--bg-sunken) text-(--gold-text)")}>
              <Icon size={15} />
            </span>
            {label(p)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="hidden text-[9px] font-bold text-(--text-tertiary) sm:inline">{vsLabel(p)}</span>
            <Delta cur={a.revenue} prev={b.revenue} />
          </span>
        </div>
        <div className={cn("relative mt-2 grid gap-x-3", fit ? "grid-cols-[1.25fr_1fr]" : "grid-cols-1 gap-y-2 min-[520px]:grid-cols-[1.25fr_1fr] md:grid-cols-1 lg:grid-cols-[1.25fr_1fr]")}>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold text-(--text-tertiary)">{t("revenue")}</div>
            <Money value={a.revenue} className="block whitespace-nowrap text-[clamp(20px,2.2vw,30px)] font-black leading-tight tracking-tight" />
          </div>
          <div className="min-w-0 border-s border-(--border-default) ps-3">
            <div className="flex items-center justify-between gap-1 text-[10.5px] font-bold text-(--text-tertiary)">
              <span>{t("profit")}</span>
              <Delta cur={a.profit} prev={b.profit} className="px-1.5 py-0 text-[10px]" />
            </div>
            <Money value={a.profit} className={cn("block whitespace-nowrap text-[clamp(15px,1.5vw,21px)] font-black leading-tight", a.profit >= 0 ? "text-(--semantic-success)" : "text-(--semantic-danger)")} />
          </div>
        </div>
        <div className="relative mt-2 flex items-center gap-2">
          <div className="flex-1"><Bar pct={mg} className="from-emerald-600 to-emerald-300" /></div>
          <span className="shrink-0 text-[10px] font-black text-(--text-secondary)" dir="ltr">{mg.toFixed(0)}% · {a.count} {t("inv")}</span>
        </div>
      </button>
    );
  };

  const kpis = [
    { l: t("orders"), v: dz(cur.count, 0), icon: Receipt, c: "bg-sky-500/15 text-sky-600", sub: <Delta cur={cur.count} prev={prev.count} className="px-1.5 py-0 text-[10px]" /> },
    { l: t("avgBasket"), v: money(Math.round(avg)), icon: ShoppingCart, c: "bg-emerald-500/15 text-emerald-600", sub: null },
    { l: t("marginPct"), v: `${marginPct.toFixed(1)}%`, icon: Percent, c: "bg-(--brand-500)/15 text-(--gold-text)", sub: null },
    { l: t("collected"), v: money(Math.round(cur.paid)), icon: Wallet2, c: "bg-teal-500/15 text-teal-600", sub: <span className="text-[10px] font-black text-(--text-tertiary)" dir="ltr">{collectedPct.toFixed(0)}%</span> },
    { l: t("expenses"), v: money(Math.round(cur.expenses)), icon: Wallet, c: "bg-orange-500/15 text-orange-500", sub: null },
    { l: t("netProfit"), v: money(Math.round(net)), icon: PiggyBank, c: net >= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-500", sub: null },
  ];

  const channelBlock = chTotal <= 0 ? null : (
    <div className="shrink-0">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-(--bg-sunken)" dir="ltr">
        {segs.map((s) => (
          <span key={s.label} className="gw-grow-x h-full" style={{ width: `${(s.value / chTotal) * 100}%`, background: s.color, transformOrigin: "left" }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] font-bold">
        {segs.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}<b className="tabular-nums text-(--text-secondary)" dir="ltr">{Math.round((s.value / chTotal) * 100)}%</b></span>
        ))}
      </div>
    </div>
  );

  const alertsBlock = (
    <>
      <div className="grid shrink-0 grid-cols-2 gap-1.5">
        <div className="min-w-0 rounded-lg bg-red-500/10 px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10px] font-bold text-(--text-secondary)"><Users size={11} />{t("clientsOwe")}</div>
          <div className="whitespace-nowrap text-[12px] font-black tabular-nums text-(--semantic-danger)">{money(extras.clientDebt)}</div>
        </div>
        <div className="min-w-0 rounded-lg bg-orange-500/10 px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10px] font-bold text-(--text-secondary)"><Truck size={11} />{t("weOwe")}</div>
          <div className="whitespace-nowrap text-[12px] font-black tabular-nums text-orange-500">{money(extras.supplierDebt)}</div>
        </div>
      </div>
      <div className="mt-1.5 shrink-0 text-[10px] font-black text-(--text-tertiary)">{t("lowStockList")} ({extras.lowCount})</div>
      {extras.lowList.length === 0 ? (
        <div className="shrink-0 text-[11px] font-bold text-(--semantic-success)">✓ {t("allGood")}</div>
      ) : (
        <ul className="shrink-0 space-y-0.5">
          {extras.lowList.slice(0, fit ? 2 : 5).map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-2 text-[11px] font-bold">
              <span className="min-w-0 line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight" title={p.name}>{p.name}</span>
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-black tabular-nums text-amber-600" dir="ltr">{qty(p.qty)} / {qty(p.min)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const recentList = (n: number) =>
    data.recent.length === 0 ? empty : (
      <ul className="min-h-0 flex-1 divide-y divide-(--border-subtle) overflow-hidden">
        {data.recent.slice(0, n).map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-(--gold-wash) text-(--gold-text)"><Receipt size={12} /></span>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight text-[11.5px] font-black">{s.client || t("walkIn")}</div>
              <div className="line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight text-[9.5px] font-bold text-(--text-tertiary)" dir="auto">{[s.van, nf.format(new Date(s.dateIso)) + " " + timeFmt.format(new Date(s.dateIso))].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="shrink-0 text-[11.5px] font-black tabular-nums">{money(Math.round(s.total))}</div>
          </li>
        ))}
      </ul>
    );

  const vanDetail = (v: (typeof data.vans)[number]) => (
    <div className={cn("grid gap-3", fit ? "grid-rows-[auto_1fr]" : "lg:grid-cols-12")}>
      <div className="grid grid-cols-3 gap-2 lg:col-span-12">
        {PERIODS.map((p) => {
          const a: Agg = v.periods[p];
          const net = a.profit - a.expenses;
          return (
            <div key={p} className="min-w-0 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5">
              <div className="mb-1 flex items-center justify-between gap-1 text-[10.5px] font-black text-(--text-secondary)">
                <span>{label(p)}</span>
                <span className="text-(--text-tertiary)">{a.count} {t("inv")}</span>
              </div>
              <div className="whitespace-nowrap text-[clamp(13px,1.3vw,17px)] font-black tabular-nums">{money(Math.round(a.revenue))}</div>
              <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[10px] font-bold text-(--text-tertiary)">
                <span className="whitespace-nowrap">{t("profit")} <span className={cn("font-black tabular-nums", a.profit >= 0 ? "text-(--semantic-success)" : "text-(--semantic-danger)")}>{money(Math.round(a.profit))}</span></span>
                <span className="whitespace-nowrap">{t("expenses")} <span className="font-black tabular-nums text-orange-500">{money(Math.round(a.expenses))}</span></span>
              </div>
              <div className={cn("mt-1.5 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ring-1", net >= 0 ? "bg-emerald-500/12 ring-emerald-500/30" : "bg-red-500/12 ring-red-500/30")}>
                <span className="flex items-center gap-1 text-[10.5px] font-black text-(--text-secondary)"><PiggyBank size={13} className={net >= 0 ? "text-emerald-600" : "text-red-500"} />{t("netProfit")}</span>
                <span className={cn("whitespace-nowrap text-[clamp(14px,1.5vw,19px)] font-black leading-none tabular-nums", net >= 0 ? "text-emerald-600" : "text-red-500")}>{money(Math.round(net))}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={cn("grid min-h-0 gap-3 lg:col-span-12", fit ? "grid-cols-3" : "md:grid-cols-3")}>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between text-[10.5px] font-black text-(--text-secondary)">
            <span>{t("last14")}</span>
            <span className="text-(--text-tertiary)" dir="ltr">{monthTotal > 0 ? ((v.periods.month.revenue / monthTotal) * 100).toFixed(0) : 0}% · {t("share")}</span>
          </div>
          <MiniBars rtl={locale === "ar"} values={v.trend.map((x) => x.r)} height={fit ? 64 : 92} />
        </div>
        {([["products", t("bestProducts")], ["clients", t("bestClients")]] as const).map(([k, title]) => (
          <div key={k} className="min-w-0">
            <div className="mb-1.5 text-[10.5px] font-black text-(--text-secondary)">{title} · {label(period)}</div>
            {v.periods[period][k].length === 0 ? (
              <div className="text-xs font-bold text-(--text-tertiary)">{t("noSales")}</div>
            ) : (
              <ul className="space-y-1">
                {v.periods[period][k].slice(0, fit ? 3 : 5).map((x, i) => (
                  <li key={x.id} className="flex items-center gap-1.5 text-[11px] font-bold">
                    <Rank i={i} />
                    <span className="min-w-0 flex-1 line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight">{k === "clients" ? <ClientName name={x.name} lat={(x as { gpsLat?: number | null }).gpsLat} lng={(x as { gpsLng?: number | null }).gpsLng} /> : x.name}</span>
                    <span className="shrink-0 text-end font-black tabular-nums">{compactNum(x.revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const vanRows = (
    <div className={cn("flex min-h-0 flex-1 flex-col", fit ? "gap-1" : "gap-2")}>
      <div className="hidden shrink-0 grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,1fr))_20px] gap-3 px-3 text-[10px] font-black text-(--text-tertiary) md:grid">
        <span>{t("van")}</span>
        {PERIODS.map((p) => <span key={p} className="text-end">{label(p)} · {t("revenue")} / {t("profit")}</span>)}
        <span />
      </div>
      <div className={cn("min-h-0 flex-1", fit ? "space-y-1 overflow-y-auto pe-0.5" : "space-y-2")}>
        {data.vans.map((v) => {
          const open = openVan === v.id;
          return (
            <div key={v.id} className={cn("overflow-hidden rounded-xl border transition-all duration-300", open && !fit ? "border-(--brand-500) bg-(--bg-surface)" : "border-(--border-default) hover:border-(--border-strong)")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenVan(open ? null : v.id)}
                className={cn("grid min-h-0 w-full grid-cols-1 items-center gap-2 text-start md:grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,1fr))_20px] md:gap-3", fit ? "px-3 py-1" : "px-3 py-2.5")}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-(--gold-wash) text-(--gold-text)", fit ? "h-6 w-6" : "h-9 w-9")}><Truck size={fit ? 13 : 17} /></span>
                  <div className="min-w-0">
                    <div className="line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight text-[12.5px] font-black">{v.name}{fit && <span className="ms-1.5 text-[10px] font-bold text-(--text-tertiary)">{v.driver}</span>}</div>
                    {!fit && <div className="line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight text-[10px] font-bold text-(--text-tertiary)">{[v.driver, v.matricule].filter(Boolean).join(" · ") || "—"}</div>}
                  </div>
                  <ChevronDown size={15} className={cn("ms-auto shrink-0 text-(--text-tertiary) transition-transform duration-300 md:hidden", open && "rotate-180")} />
                </div>
                <div className="grid grid-cols-3 gap-2 md:contents">
                  {PERIODS.map((p) => (
                    <div key={p} className="min-w-0 rounded-lg bg-(--bg-sunken) px-2 py-1 md:bg-transparent md:p-0 md:text-end">
                      <div className="text-[9.5px] font-black text-(--text-tertiary) md:hidden">{label(p)}</div>
                      <div className="whitespace-nowrap text-[12px] font-black tabular-nums">{money(Math.round(v.periods[p].revenue))}</div>
                      <div className={cn("whitespace-nowrap text-[10.5px] font-black tabular-nums", v.periods[p].profit >= 0 ? "text-(--semantic-success)" : "text-(--semantic-danger)")}>{money(Math.round(v.periods[p].profit))}</div>
                    </div>
                  ))}
                </div>
                <ChevronDown size={14} className={cn("hidden shrink-0 text-(--text-tertiary) transition-transform duration-300 md:block", open && "rotate-180")} />
              </button>
              {open && !fit && <div className="border-t border-(--border-default) p-3 md:p-4" style={{ animation: "gw-fade 0.35s ease" }}>{vanDetail(v)}</div>}
            </div>
          );
        })}
        <div className={cn("grid grid-cols-1 items-center gap-2 rounded-xl border border-dashed border-(--border-default) px-3 md:grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,1fr))_20px] md:gap-3", fit ? "py-1" : "py-2.5")}>
          <div className="flex items-center gap-2 text-[12.5px] font-black text-(--text-secondary)"><span className={cn("flex items-center justify-center rounded-lg bg-(--bg-sunken)", fit ? "h-6 w-6" : "h-9 w-9")}><Store size={14} /></span>{t("otherSales")}</div>
          <div className="grid grid-cols-3 gap-2 md:contents">
            {PERIODS.map((p) => (
              <div key={p} className="min-w-0 md:text-end">
                <div className="whitespace-nowrap text-[12px] font-black tabular-nums text-(--text-secondary)">{money(Math.round(data.other[p].revenue))}</div>
                <div className="whitespace-nowrap text-[10.5px] font-black tabular-nums text-(--text-tertiary)">{money(Math.round(data.other[p].profit))}</div>
              </div>
            ))}
          </div>
          <span />
        </div>
      </div>
    </div>
  );

  const openVanObj = data.vans.find((v) => v.id === openVan) ?? null;
  const vansPanel = (
    <Panel
      fit={fit}
      className={fit ? "col-span-6" : "xl:col-span-8"}
      title={t("vansPerf")}
      icon={Truck}
      right={<span className="hidden text-[10.5px] font-bold text-(--text-tertiary) sm:block">{t("vansPerfHint")}</span>}
    >
      {data.vans.length === 0 ? <div className="py-8 text-center text-xs font-bold text-(--text-tertiary)">{t("noVans")}</div> : vanRows}
      {fit && openVanObj && (
        <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto rounded-2xl bg-(--bg-overlay) p-3" style={{ animation: "gw-pop 0.25s var(--ease-out)" }}>
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-[12.5px] font-black">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-(--brand-contrast)"><Truck size={13} /></span>
              <span className="line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight">{openVanObj.name}</span>
              <span className="line-clamp-2 break-words [overflow-wrap:anywhere] leading-tight text-[10.5px] font-bold text-(--text-tertiary)">{[openVanObj.driver, openVanObj.matricule].filter(Boolean).join(" · ")}</span>
            </h3>
            <button type="button" onClick={() => setOpenVan(null)} aria-label="close" className="flex h-6 min-h-0 w-6 min-w-0 items-center justify-center rounded-lg border border-(--border-default) text-(--text-secondary) hover:border-(--brand-500)">×</button>
          </div>
          {vanDetail(openVanObj)}
        </div>
      )}
    </Panel>
  );

  const header = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div className={cn("min-w-0", fit && "flex items-baseline gap-3")}>
        <h1 className={cn("truncate font-black tracking-tight", fit ? "text-base" : "text-xl sm:text-2xl")}>
          {t("hello")} <span className="text-(--gold-text)">{userName}</span>
        </h1>
        <p className={cn("flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-(--text-secondary)", !fit && "mt-0.5")}>
          <span className="flex items-center gap-1.5"><i className="gw-live inline-block h-2 w-2 rounded-full bg-(--semantic-success)" />{longDate}</span>
          {!fit && <span className="hidden text-(--text-tertiary) sm:inline">· {t("overview")}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Seg small={fit} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ v: p, label: label(p) }))} />
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          aria-label={t("refresh")}
          title={`${t("updated")} ${timeFmt.format(new Date(data.nowIso))}`}
          className={cn("flex min-h-0 min-w-0 items-center justify-center rounded-xl border border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) hover:border-(--brand-500) hover:text-(--gold-text)", fit ? "h-7 w-7" : "h-9 w-9")}
        >
          <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
        </button>
      </div>
    </div>
  );

  const kpiStrip = (
    <div className={cn("grid shrink-0 gap-2.5", fit ? "grid-cols-6" : "grid-cols-2 md:grid-cols-3 2xl:grid-cols-6")}>
      {kpis.map((k) => (
        <div key={k.l} className={cn("group relative flex min-w-0 items-center gap-2.5 overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) transition-all duration-300 hover:-translate-y-0.5 hover:border-(--border-strong)", fit ? "p-2" : "p-3")}>
          <span className={cn("flex shrink-0 items-center justify-center rounded-xl", fit ? "h-8 w-8" : "h-10 w-10", k.c)}><k.icon size={fit ? 15 : 18} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-[10.5px] font-bold text-(--text-tertiary)">{k.l}</span>
              {k.sub}
            </div>
            <div className="whitespace-nowrap text-[clamp(13px,1.2vw,17px)] font-black leading-tight tabular-nums">{k.v}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const trendPanel = (
    <Panel
      fit={fit}
      className={fit ? "col-span-6" : "xl:col-span-8"}
      title={t("trendTitle")}
      icon={BarChart3}
      right={
        <div className="flex items-center gap-3 text-[10.5px] font-black text-(--text-secondary)">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-(--brand-500)" />{t("revenue")}</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-(--semantic-success)" />{t("profit")}</span>
        </div>
      }
    >
      <TrendChart rtl={locale === "ar"} data={trend} revenueLabel={t("revenue")} profitLabel={t("profit")} money={money} minHeight={fit ? 120 : 260} />
    </Panel>
  );

  const metricSeg = (
    <Seg small value={prodMetric} onChange={setProdMetric} options={[{ v: "revenue", label: t("mRevenue") }, { v: "profit", label: t("mProfit") }, { v: "qty", label: t("mQty") }]} />
  );
  const productsPanel = (
    <Panel fit={fit} className={fit ? "col-span-3" : ""} title={t("topProducts")} icon={Package} right={fit ? undefined : metricSeg}>
      {fit && <div className="mb-2 flex shrink-0">{metricSeg}</div>}
      {products.length === 0 ? empty : <RankList items={productItems} max={prodMax} fit={fit} t={t as unknown as (k: string) => string} green={prodMetric === "profit"} />}
    </Panel>
  );
  const clientsPanel = (
    <Panel fit={fit} className={fit ? "col-span-3" : "md:col-span-2 xl:col-span-1"} title={`${t("topClients")} · ${label(period)}`} icon={Trophy}>
      {clients.length === 0 ? empty : <RankList items={clientItems} max={cliMax} fit={fit} t={t as unknown as (k: string) => string} />}
    </Panel>
  );
  const topVansPanel = (
    <Panel fit={fit} className={fit ? "col-span-3" : ""} title={`${t("topVans")} · ${label(period)}`} icon={Truck}>
      {vans.length === 0 ? empty : <RankList items={vanItems} max={vanMax} fit={fit} t={t as unknown as (k: string) => string} />}
    </Panel>
  );
  const pulsePanel = (
    <Panel fit={fit} className={fit ? "col-span-3" : ""} title={`${t("alerts")} · ${t("channelMix")}`} icon={AlertTriangle}>
      {channelBlock}
      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {alertsBlock}
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="mb-0.5 shrink-0 text-[10px] font-black text-(--text-tertiary)">{t("recentSales")}</div>
          {recentList(fit ? 2 : 6)}
        </div>
      </div>
    </Panel>
  );

  const shortcuts = actions.length > 0 && !fit && (
    <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
      {actions.map((a) => {
        const Icon = ICONS[a.icon] ?? Store;
        return (
          <Link key={a.href} href={`/${locale}/${a.href}`} className="dash-lift flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5 text-center hover:border-(--brand-500)">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", a.cls)}><Icon size={18} /></span>
            <span className="w-full truncate text-[11px] font-black leading-tight">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="relative w-full" style={fit && box ? { height: box.h, overflow: "hidden" } : undefined}>
      {/* measures the space under the top bar (zoom-aware --vh) */}
      <div ref={probeRef} aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-[calc(var(--vh)-3.5rem)]" />
      {fit && box ? (
        <div className="flex flex-col gap-2.5 p-3" style={{ zoom: scale, width: box.w / scale, height: box.h / scale } as React.CSSProperties}>
          {header}
          <div className="grid shrink-0 grid-cols-3 gap-2.5">{PERIODS.map(periodCard)}</div>
          {kpiStrip}
          <div className="grid min-h-0 flex-1 grid-cols-12 grid-rows-[minmax(0,1fr)_minmax(0,1.14fr)] gap-2.5">
            {trendPanel}
            {productsPanel}
            {clientsPanel}
            {vansPanel}
            {topVansPanel}
            {pulsePanel}
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[1800px] space-y-4 p-4 sm:p-5 md:p-6">
          {header}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{PERIODS.map(periodCard)}</div>
          {kpiStrip}
          <div className="grid gap-4 xl:grid-cols-12">
            {trendPanel}
            <Panel className="xl:col-span-4" title={`${t("alerts")} · ${t("channelMix")}`} icon={AlertTriangle}>
              {channelBlock}
              <div className="mt-3">{alertsBlock}</div>
            </Panel>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {productsPanel}
            {topVansPanel}
            {clientsPanel}
          </div>
          <div className="grid gap-4 xl:grid-cols-12">
            {vansPanel}
            <Panel className="xl:col-span-4" title={t("recentSales")} icon={Coins}>{recentList(8)}</Panel>
          </div>
          {shortcuts}
        </div>
      )}
    </div>
  );
}

/// Full money in the stacked layout; compact (1.2M) in the one-screen layout.
function compactOrFull(v: number, fit: boolean): string {
  return fit ? compactNum(Math.round(v)) + " DA" : dzMoney(Math.round(v));
}
