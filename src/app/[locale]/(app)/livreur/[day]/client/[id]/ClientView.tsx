"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight, Banknote, CalendarClock, ClipboardList, Gift, Lock, MapPin, Navigation, Phone,
  Plus, ReceiptText, RefreshCw, Store, TrendingDown, TrendingUp, Trophy, Wallet,
} from "lucide-react";
import { ClosedShopButton, useClosedIds } from "@/components/livreur/ClosedShopButton";
import { OnlineBadge } from "@/components/sync/OnlineBadge";
import { getLastSync, getPendingClients, goPage, pendingCount, syncNow } from "@/lib/sync/client";
import { dzMoney, fmtDT } from "@/lib/format";
import { canSell } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import type { ClientStats } from "@/lib/livreur/client-stats";

type ClientInfo = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  activity: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  balance: number;
  tier: string | null;
  sector: string | null;
  wilaya: string | null;
  since: string;
};

type Labels = Record<string, string>;

/// Client display. One responsive column on phones; on wide screens the
/// statistics and the invoice list sit side by side.
export function ClientView({
  locale,
  day,
  clientId,
  client: serverClient,
  stats,
  closed,
  closedToday,
  hasStarted,
  role,
  labels,
}: {
  locale: string;
  day: string;
  clientId: string;
  client: ClientInfo | null;
  stats: ClientStats | null;
  closed: boolean;
  closedToday: string[];
  hasStarted: boolean;
  role: string;
  labels: Labels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filtering, startFilter] = useTransition();
  const loc = `${locale}-u-nu-latn`;
  const closedState = useClosedIds(closed ? [clientId, ...closedToday] : closedToday);
  const isClosed = closedState.ids.has(clientId);

  // An unsynced client lives only on this phone.
  const [local, setLocal] = useState<ClientInfo | null>(null);
  useEffect(() => {
    if (serverClient || !clientId.startsWith("pending:")) return;
    let dead = false;
    getPendingClients()
      .then((list) => {
        const hit = list.find((p) => `pending:${p.opId}` === clientId);
        if (hit && !dead) {
          setLocal({
            id: clientId, name: hit.name, code: hit.code, phone: hit.phone ?? null, address: null, activity: null,
            gpsLat: null, gpsLng: null, balance: 0, tier: null, sector: null, wilaya: null, since: new Date().toISOString(),
          });
        }
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [serverClient, clientId]);
  const c = serverClient ?? local;

  // Sync tile: pending count + last sync, one tap pushes/pulls then refreshes.
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  async function readSync() {
    try {
      setPending(await pendingCount());
      const ls = await getLastSync();
      setLastSync(ls ? String(ls) : null);
    } catch { /* keep last values */ }
  }
  useEffect(() => { void readSync(); }, []);
  async function doSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncNow();
    } catch { /* stays queued */ }
    await readSync();
    router.refresh();
    setSyncing(false);
  }

  /// Month filter lives in the URL (?m=YYYY-MM | all) so it survives refresh.
  function pickMonth(key: string) {
    if (!stats || key === stats.selected) return;
    startFilter(() => router.replace(`${pathname}?m=${key}`, { scroll: false }));
  }
  const isAll = stats?.selected === "all";

  const qs = `?client=${encodeURIComponent(clientId)}`;
  const mayAct = hasStarted || role === "Admin";
  const sellOk = canSell(role);
  const mapsUrl = c && c.gpsLat != null && c.gpsLng != null ? `https://www.google.com/maps/dir/?api=1&destination=${c.gpsLat},${c.gpsLng}` : null;
  const debt = c?.balance ?? 0;

  /// Only months that actually have sales (the selected one always stays visible).
  const dataMonths = stats?.months.filter((m) => m.count > 0 || m.current) ?? [];
  const maxMonth = Math.max(1, ...dataMonths.map((m) => m.total));
  const trend =
    stats && stats.prevMonthSold && stats.prevMonthSold > 0
      ? Math.round(((stats.monthSold - stats.prevMonthSold) / stats.prevMonthSold) * 100)
      : null;
  const maxProd = Math.max(1, ...(stats?.topProducts.map((p) => p.revenue) ?? [0]));

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-3 overflow-x-hidden p-3 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:p-4 md:p-5">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => goPage(router, `/${locale}/livreur/${day}`)}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-3 text-sm font-black active:scale-[0.97]"
        >
          <ArrowRight size={16} className="rtl:rotate-0 ltr:rotate-180" />
          {labels.back}
        </button>
        <div className="flex-1" />
        <OnlineBadge onlineLabel={labels.online} offlineLabel={labels.offline} />
      </div>

      {!c ? (
        <p className="py-16 text-center text-sm opacity-60">…</p>
      ) : (
        <>
          {/* Hero */}
          <section className="relative overflow-hidden rounded-3xl bg-gradient-brand p-3.5 text-(--brand-contrast) shadow-lg sm:p-5">
            <div className="pointer-events-none absolute -end-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-14 start-1/3 h-32 w-32 rounded-full bg-white/10" />
            <div className="relative flex items-start gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black backdrop-blur sm:h-16 sm:w-16 sm:text-3xl">
                {c.name.trim().charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-lg font-black leading-tight sm:text-2xl">{c.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-black sm:gap-1.5 sm:text-[11px]">
                  <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono" dir="ltr">{c.code}</span>
                  {c.tier && <span className="rounded-full bg-white/20 px-2 py-0.5">{c.tier}</span>}
                  {isClosed && <span className="rounded-full bg-red-600 px-2 py-0.5 text-white">🔒 {labels.closedToday}</span>}
                  {c.id.startsWith("pending:") && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-black">⏳ {labels.unsynced}</span>}
                </div>
              </div>
              {/* One-tap contact */}
              <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                {c.phone && (
                  <a
                    href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                    aria-label={labels.callClient}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-600 shadow active:scale-90"
                  >
                    <Phone size={19} />
                  </a>
                )}
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={labels.navigate}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/25 backdrop-blur active:scale-90"
                  >
                    <Navigation size={19} />
                  </a>
                )}
              </div>
            </div>

            {/* Debt strip */}
            <div className="relative mt-3.5 flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-3.5 py-2.5 backdrop-blur sm:mt-4 sm:px-4 sm:py-3">
              <div className="flex min-w-0 items-center gap-2 text-[13px] font-black sm:text-sm">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", debt > 0 ? "bg-amber-300" : debt < 0 ? "bg-sky-300" : "bg-emerald-300")} />
                <span className="truncate">{debt > 0 ? labels.debt : debt < 0 ? labels.credit : labels.noDebt}</span>
              </div>
              <div className="shrink-0 text-xl font-black tabular-nums sm:text-2xl" dir="ltr">{dzMoney(Math.abs(debt))}</div>
            </div>
          </section>

          {/* Info tiles: compact 2-column grid, address spans the row */}
          <section className="grid grid-cols-2 gap-2">
            {(c.address || c.sector || c.wilaya) ? (
              <InfoTile className="col-span-2" Icon={MapPin} tone="bg-sky-500/15 text-sky-600" label={labels.address}>
                {[c.address, c.sector, c.wilaya].filter(Boolean).join(" · ")}
              </InfoTile>
            ) : null}
            {c.phone ? (
              <InfoTile Icon={Phone} tone="bg-emerald-500/15 text-emerald-600" label={labels.phone}>
                <bdi dir="ltr" className="tabular-nums">{c.phone}</bdi>
              </InfoTile>
            ) : null}
            <InfoTile Icon={CalendarClock} tone="bg-amber-500/15 text-amber-600" label={labels.lastSale}>
              {stats?.lastSaleAt ? fmtDT(stats.lastSaleAt, loc) : labels.never}
            </InfoTile>
            {c.activity ? (
              <InfoTile Icon={Store} tone="bg-violet-500/15 text-violet-500" label={labels.activity}>
                {c.activity}
              </InfoTile>
            ) : null}
          </section>

          {/* Actions */}
          <section className="grid grid-cols-3 gap-2">
            {sellOk && (
              <ActionTile
                label={labels.newSale}
                Icon={Plus}
                primary
                locked={!mayAct}
                onClick={() => goPage(router, `/${locale}/livreur/${day}/vente${qs}`)}
              />
            )}
            <ActionTile
              label={labels.newCommand}
              Icon={ClipboardList}
              locked={!mayAct}
              onClick={() => goPage(router, `/${locale}/livreur/${day}/commande${qs}`)}
            />
            <ActionTile
              label={`${labels.syncT}${pending > 0 ? ` (${pending})` : ""}`}
              sub={lastSync ? `${labels.lastSync}: ${new Date(lastSync).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Algiers" })}` : labels.pending}
              Icon={RefreshCw}
              spin={syncing}
              onClick={() => void doSync()}
            />
          </section>
          {!mayAct && <p className="text-center text-[11px] font-bold opacity-60">{labels.closedNeedStart}</p>}
          <ClosedShopButton
            client={{ id: c.id, name: c.name, code: c.code }}
            closed={isClosed}
            canReport={mayAct}
            labels={labels}
            onSaved={(id) => closedState.add(id)}
          />

          {/* Statistics */}
          {stats ? (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
              <div className={cn("min-w-0 space-y-3 transition-opacity", filtering && "opacity-50")}>
                {/* Month filter */}
                <section className="-mx-3 flex snap-x gap-1.5 overflow-x-auto px-3 pb-1 sm:-mx-1 sm:px-1" role="tablist" aria-label={labels.period}>
                  {[{ key: "all", label: labels.all, current: isAll }, ...[...dataMonths].reverse()].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="tab"
                      aria-selected={m.current}
                      onClick={() => pickMonth(m.key)}
                      className={cn(
                        "h-9 shrink-0 rounded-full px-3.5 text-xs font-black transition-colors",
                        m.current ? "bg-(--brand-500) text-(--brand-contrast)" : "bg-(--bg-sunken) text-(--text-secondary)",
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </section>
                {/* KPIs */}
                <section className="grid grid-cols-3 gap-2">
                  <div className="col-span-3 rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold opacity-60">
                          {isAll ? labels.totalSold : stats.selectedIsCurrent ? labels.monthSold : stats.selectedLabel}
                        </div>
                        <div className="mt-1 text-[1.75rem] font-black leading-none tabular-nums text-(--brand-600) sm:text-3xl" dir="ltr">{dzMoney(stats.monthSold)}</div>
                        <div className="mt-0.5 text-[11px] font-bold opacity-55">{stats.monthCount} {labels.invoices}</div>
                      </div>
                      {trend !== null && (
                        <span
                          className={cn(
                            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black",
                            trend >= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600",
                          )}
                          title={labels.vsLast}
                        >
                          {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          <span dir="ltr">{trend > 0 ? "+" : ""}{trend}%</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <Kpi Icon={Wallet} label={labels.totalSold} value={dzMoney(stats.totalSold)} tone="text-sky-600 bg-sky-500/15" />
                  <Kpi Icon={ReceiptText} label={labels.invoices} value={String(stats.invoiceCount)} tone="text-violet-500 bg-violet-500/15" />
                  <Kpi Icon={Banknote} label={labels.avgTicket} value={dzMoney(stats.avgTicket)} tone="text-amber-600 bg-amber-500/15" />
                </section>

                {/* 6-month bars */}
                <section className="rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-4">
                  <div className="mb-3 text-sm font-black">{labels.last6}</div>
                  <div className="flex h-32 items-end justify-center gap-1.5" dir="ltr">
                    {dataMonths.map((m) => (
                      <button
                        type="button"
                        key={m.key}
                        onClick={() => pickMonth(m.key)}
                        aria-label={`${m.label} ${dzMoney(m.total)}`}
                        className="flex h-full min-w-0 max-w-14 flex-1 flex-col items-center justify-end gap-1"
                      >
                        {m.current && m.total > 0 && (
                          <span className="text-[9px] font-black tabular-nums text-(--brand-600)">{m.total >= 1000 ? `${Math.round(m.total / 100) / 10}k` : Math.round(m.total)}</span>
                        )}
                        <div
                          className={cn("w-full rounded-t-md", m.current ? "bg-gradient-brand" : "bg-(--brand-500)/30")}
                          style={{ height: `${Math.max(m.total > 0 ? 6 : 2, (m.total / maxMonth) * 100)}%` }}
                        />
                        <span className={cn("w-full truncate text-center text-[9px] font-black", m.current ? "text-(--brand-600)" : "opacity-60")}>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Top products */}
                <section className="rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black">
                    <Trophy size={16} className="text-amber-500" />
                    {labels.topProducts}
                  </div>
                  {stats.topProducts.length === 0 ? (
                    <p className="text-xs opacity-60">{labels.noProducts}</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {stats.topProducts.map((p, i) => (
                        <li key={p.productId}>
                          <div className="flex items-center gap-2 text-sm font-black">
                            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]", i === 0 ? "bg-amber-400 text-black" : "bg-(--bg-sunken)")}>{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 text-xs tabular-nums opacity-70" dir="ltr">{Math.round(p.qty * 100) / 100} {labels.units}</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-(--bg-sunken)">
                            <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${Math.max(4, (p.revenue / maxProd) * 100)}%` }} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                {/* This month's offers */}
                <section className="rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-black">
                      <Gift size={16} className="text-rose-500" />
                      {labels.offers}{isAll ? "" : ` · ${stats.selectedIsCurrent ? labels.thisMonth : stats.selectedLabel}`}
                    </span>
                    {stats.offersQty > 0 && (
                      <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-black text-rose-600" dir="ltr">
                        {Math.round(stats.offersQty * 100) / 100} {labels.freeUnits}
                      </span>
                    )}
                  </div>
                  {stats.offers.length === 0 ? (
                    <p className="text-xs opacity-60">{labels.noOffers}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {stats.offers.map((o) => (
                        <li key={o.name} className="rounded-full bg-(--bg-sunken) px-3 py-1 text-xs font-black">
                          {o.name} <span className="tabular-nums opacity-60" dir="ltr">×{Math.round(o.qty * 100) / 100}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              {/* Invoices */}
              <section className={cn("rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-4 min-w-0 transition-opacity lg:self-start", filtering && "opacity-50")}>
                <div className="mb-3 flex items-center gap-2 text-sm font-black">
                  <ReceiptText size={16} className="text-(--brand-600)" />
                  {labels.invoicesTitle}
                  <span className="rounded-full bg-(--bg-sunken) px-2 py-0.5 text-[11px] tabular-nums">{isAll ? stats.invoiceCount : stats.monthCount}</span>
                </div>
                {stats.recent.length === 0 ? (
                  <p className="py-6 text-center text-xs opacity-60">{labels.noInvoices}</p>
                ) : (
                  <ul className="space-y-2">
                    {stats.recent.map((s) => {
                      const rest = Math.max(0, s.total - s.paid);
                      return (
                        <li key={s.id} className="rounded-2xl border border-(--border-default) bg-(--bg-surface) p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-mono text-xs font-black" dir="ltr">{s.number}</span>
                            <span className="shrink-0 text-base font-black tabular-nums" dir="ltr">{dzMoney(s.total)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-bold">
                            <span className="opacity-60">{fmtDT(s.date, loc)}</span>
                            <span className="flex items-center gap-1">
                              {s.onHold && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-600">{labels.onHold}</span>}
                              {rest > 0.009 ? (
                                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-600" dir="ltr">{labels.due} {dzMoney(rest)}</span>
                              ) : (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-600">{labels.paid}</span>
                              )}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ActionTile({
  label, sub, Icon, primary, locked, spin, onClick,
}: {
  label: string;
  sub?: string;
  Icon: typeof Plus;
  primary?: boolean;
  locked?: boolean;
  spin?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      className={cn(
        "relative flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-2 shadow-sm transition-all active:scale-[0.97] disabled:opacity-50",
        primary
          ? "border-transparent bg-(--brand-500) text-(--brand-contrast)"
          : "border-(--border-default) bg-(--bg-overlay)",
      )}
    >
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", primary ? "bg-white/20" : "bg-(--brand-500)/12 text-(--brand-600)")}>
        <Icon size={20} className={cn(spin && "animate-spin")} />
      </span>
      <span className="w-full truncate px-0.5 text-center text-[12px] font-black sm:text-[13px]">{label}</span>
      {sub && <span className="w-full truncate px-0.5 text-center text-[9px] opacity-60">{sub}</span>}
      {locked && <Lock size={12} className="absolute start-1.5 top-1.5 opacity-70" />}
    </button>
  );
}

function InfoTile({
  Icon, tone, label, children, className,
}: {
  Icon: typeof Plus;
  tone: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5", className)}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}><Icon size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold opacity-55">{label}</span>
        <span className="block break-words text-[13px] font-black leading-snug">{children}</span>
      </span>
    </div>
  );
}

function Kpi({
  Icon, label, value, tone, className,
}: {
  Icon: typeof Plus;
  label: string;
  value: string;
  tone: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5", className)}>
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", tone)}><Icon size={14} /></span>
      <div className="mt-1.5 truncate text-[15px] font-black tabular-nums sm:text-lg" dir="ltr">{value}</div>
      <div className="truncate text-[10px] font-bold opacity-60">{label}</div>
    </div>
  );
}
