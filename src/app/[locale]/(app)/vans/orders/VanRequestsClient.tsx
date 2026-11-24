"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarCheck, Check, Clock, ExternalLink, Package, Printer, Search, Truck, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/Card";
import { fmtDT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/data-sync";
import { summarize } from "@/lib/transfers/summary";

type Line = {
  id: string; declaredQty: unknown; confirmedQty: unknown;
  product: {
    id: string; name: string; images?: Array<{ url: string }>;
    baseUnit?: { name: string } | null;
    conversions?: Array<{ unitId: string; factor: unknown; unit: { name: string } }>;
  } | null;
};
type Row = {
  id: string; number: string; status: string; date: unknown; notes: string | null;
  fromLocation: { name: string } | null;
  toLocation: { name: string; matricule?: string | null; user?: { fullName: string } | null } | null;
  lines: Line[];
};

type Status = "DECLARED" | "CONFIRMED" | "REJECTED" | "ALL";
type Range = "all" | "today" | "7" | "30";

const TONE: Record<string, { bar: string; chip: string }> = {
  DECLARED: { bar: "bg-amber-500", chip: "bg-amber-500/15 text-amber-600" },
  CONFIRMED: { bar: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-600" },
  REJECTED: { bar: "bg-red-500", chip: "bg-red-500/15 text-red-500" },
  CANCELLED: { bar: "bg-neutral-400", chip: "bg-(--bg-sunken) opacity-70" },
};

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/// Admin van-requests board: every depot→van transfer. A request is a card
/// (status, route, products, colis, how long it has been waiting); clicking it
/// opens the printable transfer note in a popup, where it can also be approved
/// or rejected. Approving moves the stock depot→van at once (single step, no
/// van-side confirmation); rejecting returns the holding to the depot — both
/// are 2-tap armed. Admin-only page (proxy).
export function VanRequestsClient({
  locale,
  rows: initial,
  labels,
  statusLabel,
}: {
  locale: string;
  rows: Row[];
  labels: Record<string, string>;
  statusLabel: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useSyncedState(initial);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(() => (initial.some((r) => r.status === "DECLARED") ? "DECLARED" : "ALL"));
  const [q, setQ] = useState("");
  const [van, setVan] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  /// Bump to reload the document in the popup (after approve / reject).
  const [docKey, setDocKey] = useState(0);

  /// A clock that ticks every minute: "waiting since…" stays right without a reload.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const now = new Date(nowMs);
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }), [locale]);
  const ago = (iso: unknown): string => {
    const mins = Math.max(0, Math.round((nowMs - new Date(String(iso)).getTime()) / 60000));
    if (mins < 60) return rtf.format(-Math.max(1, mins), "minute");
    if (mins < 1440) return rtf.format(-Math.round(mins / 60), "hour");
    return rtf.format(-Math.round(mins / 1440), "day");
  };

  async function act(id: string, action: "confirm" | "reject") {
    const key = `${id}:${action}`;
    if (armed !== key) {
      setArmed(key);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transfers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? labels.failed ?? "failed");
        return;
      }
      setArmed(null);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: action === "confirm" ? "CONFIRMED" : "REJECTED" } : r)));
      setDocKey((k) => k + 1);
      router.refresh();
    } catch {
      setError(labels.failed ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  const vans = useMemo(() => [...new Set(rows.map((r) => r.toLocation?.name).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, locale, { numeric: true })), [rows, locale]);
  const enriched = useMemo(() => rows.map((r) => ({ r, s: summarize(r.lines) })), [rows]);

  const kpi = useMemo(() => {
    let pending = 0, pendingColis = 0, today = 0, rejected = 0;
    for (const { r, s } of enriched) {
      if (r.status === "DECLARED") { pending++; pendingColis += s.colis; }
      if (r.status === "CONFIRMED" && sameDay(new Date(String(r.date)), now)) today++;
      if (r.status === "REJECTED") rejected++;
    }
    return { pending, pendingColis: Math.round(pendingColis * 100) / 100, today, rejected };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched]);

  const counts = useMemo(() => ({
    DECLARED: rows.filter((r) => r.status === "DECLARED").length,
    CONFIRMED: rows.filter((r) => r.status === "CONFIRMED").length,
    REJECTED: rows.filter((r) => r.status === "REJECTED").length,
    ALL: rows.length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const day = 86_400_000;
    return enriched
      .filter(({ r }) => status === "ALL" || r.status === status)
      .filter(({ r }) => !van || r.toLocation?.name === van)
      .filter(({ r }) => {
        if (range === "all") return true;
        const t = new Date(String(r.date));
        return range === "today" ? sameDay(t, new Date(nowMs)) : nowMs - t.getTime() <= Number(range) * day;
      })
      .filter(({ r }) => !needle || [r.number, r.toLocation?.name, r.toLocation?.matricule, r.toLocation?.user?.fullName, r.fromLocation?.name, ...r.lines.map((l) => l.product?.name)]
        .some((x) => x?.toLowerCase().includes(needle)))
      .sort((a, b) => (newestFirst ? 1 : -1) * (new Date(String(b.r.date)).getTime() - new Date(String(a.r.date)).getTime()));
  }, [enriched, status, van, range, q, newestFirst, nowMs]);

  const open = rows.find((r) => r.id === openId) ?? null;
  const openSum = open ? summarize(open.lines) : null;

  const actionButtons = (r: Row, stretch = true) => (
    <div className={cn("flex gap-2", stretch && "w-full")}>
      <Button
        variant={armed === `${r.id}:reject` ? "destructive" : "secondary"}
        onClick={() => void act(r.id, "reject")}
        disabled={busy}
        className="flex-1"
        data-testid={`reject-${r.number}`}
      >
        <X size={15} /> {armed === `${r.id}:reject` ? `؟ ${labels.reject}` : labels.reject}
      </Button>
      <Button
        variant="primary"
        onClick={() => void act(r.id, "confirm")}
        disabled={busy}
        className="flex-[2]"
        data-testid={`validate-${r.number}`}
      >
        {busy && armed === `${r.id}:confirm` ? "…" : <><Check size={15} /> {armed === `${r.id}:confirm` ? `؟ ${labels.validate}` : labels.validate}</>}
      </Button>
    </div>
  );

  const chip = (on: boolean) =>
    cn("h-9 shrink-0 rounded-full px-3.5 text-xs font-black transition-colors", on ? "bg-gradient-brand text-(--brand-contrast) shadow" : "border border-(--border-default) bg-(--bg-overlay) hover:border-(--brand-500)");

  return (
    <div className="mx-auto w-full max-w-[110rem] space-y-4 p-4 pb-10 md:p-6 xl:px-10">
      <div className="flex items-center gap-3">
        <span className="bg-gradient-brand flex h-11 w-11 items-center justify-center rounded-2xl text-(--brand-contrast)"><Truck size={22} /></span>
        <div>
          <h1 className="text-xl font-black leading-tight">{labels.title}</h1>
          <p className="text-xs font-bold opacity-60">{rows.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label={labels.kpiPending} value={String(kpi.pending)} icon={<Clock size={18} />} accent="bg-amber-500/15 text-amber-600" compact />
        <KpiCard label={labels.kpiColisPending} value={String(kpi.pendingColis)} icon={<Package size={18} />} accent="bg-violet-500/15 text-violet-500" compact />
        <KpiCard label={labels.kpiToday} value={String(kpi.today)} icon={<CalendarCheck size={18} />} accent="bg-emerald-500/15 text-emerald-600" compact />
        <KpiCard label={labels.kpiRejected} value={String(kpi.rejected)} icon={<XCircle size={18} />} accent="bg-red-500/15 text-red-500" compact />
      </div>

      {/* filters */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 opacity-40" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.search} className="ps-9" />
          </div>
          <select value={van} onChange={(e) => setVan(e.target.value)} className="h-11 rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm font-bold outline-none focus:border-(--brand-500)">
            <option value="">{labels.allVans}</option>
            {vans.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <button type="button" onClick={() => setNewestFirst((v) => !v)} className={chip(false)}>{newestFirst ? labels.sortNew : labels.sortOld} ⇅</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(["DECLARED", "CONFIRMED", "REJECTED", "ALL"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setStatus(f)} aria-pressed={status === f} className={chip(status === f)}>
              {f === "ALL" ? labels.statusAll : statusLabel[f] ?? f} <span className="tabular-nums opacity-70">({counts[f]})</span>
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-(--border-default) sm:block" aria-hidden />
          {([["all", labels.rangeAll], ["today", labels.rangeToday], ["7", labels.range7], ["30", labels.range30]] as const).map(([k, text]) => (
            <button key={k} type="button" onClick={() => setRange(k)} aria-pressed={range === k} className={chip(range === k)}>{text}</button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-sm font-bold text-red-500" dir="ltr">{error}</p>}

      {/* cards */}
      <div className="grid gap-3 md:grid-cols-2 min-[1700px]:grid-cols-3">
        {visible.map(({ r, s }) => {
          const tone = TONE[r.status] ?? TONE.CANCELLED;
          const imgs = r.lines.map((l) => l.product).filter((p) => p);
          const shown = imgs.slice(0, 5);
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => { setArmed(null); setOpenId(r.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setArmed(null); setOpenId(r.id); } }}
              className="group relative cursor-pointer overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 ps-5 text-start transition-all hover:-translate-y-0.5 hover:border-(--brand-500) hover:shadow-[0_14px_30px_-18px_var(--brand-500)] focus-visible:outline-2 focus-visible:outline-(--brand-500)"
              data-testid={`request-${r.number}`}
            >
              <span aria-hidden className={cn("absolute inset-y-0 start-0 w-1.5", tone.bar)} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-base font-black" dir="ltr">{r.number}</div>
                  <div className="text-[11px] font-bold opacity-60">
                    {fmtDT(r.date as string, locale)}
                    {r.status === "DECLARED" && <span className="ms-1.5 text-amber-600">· {ago(r.date)}</span>}
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black", tone.chip)}>{statusLabel[r.status] ?? r.status}</span>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
                <span className="min-w-0 truncate text-xs font-bold opacity-70">{r.fromLocation?.name ?? ""}</span>
                <ArrowRight size={14} className="shrink-0 text-(--brand-600) rtl:rotate-180" aria-hidden />
                <Truck size={14} className="shrink-0 text-(--brand-600)" aria-hidden />
                <span className="min-w-0 truncate text-sm font-black">{r.toLocation?.name ?? ""}</span>
                {r.toLocation?.matricule && <span className="hidden shrink-0 font-mono text-[10px] opacity-50 sm:inline" dir="ltr">{r.toLocation.matricule}</span>}
              </div>
              {r.toLocation?.user && <p className="mt-1 truncate text-[11px] font-bold opacity-60">{labels.driver}: {r.toLocation.user.fullName}</p>}

              <div className="mt-3 flex items-center gap-3">
                <div className="flex -space-x-2 rtl:space-x-reverse" aria-hidden>
                  {shown.map((p, i) => (
                    p!.images?.[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={p!.images![0].url} alt="" loading="lazy" className="h-9 w-9 rounded-full border-2 border-(--bg-overlay) object-cover" />
                    ) : (
                      <span key={i} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-(--bg-overlay) bg-(--brand-500)/15 text-xs font-black text-(--brand-600)">{p!.name.trim().charAt(0)}</span>
                    )
                  ))}
                  {imgs.length > shown.length && (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-(--bg-overlay) bg-(--bg-sunken) text-[11px] font-black">+{imgs.length - shown.length}</span>
                  )}
                </div>
                <div className="ms-auto flex gap-1.5 text-center">
                  <span className="rounded-lg bg-(--bg-sunken) px-2.5 py-1 text-[11px] font-black tabular-nums"><b className="text-sm">{s.products}</b> {labels.products}</span>
                  <span className="rounded-lg bg-(--brand-500)/10 px-2.5 py-1 text-[11px] font-black tabular-nums text-(--brand-600)"><b className="text-sm">{s.colis}</b> {labels.colis}</span>
                </div>
              </div>

              {r.notes && <p className="mt-2 line-clamp-1 text-xs opacity-60">{r.notes}</p>}

              <div className="mt-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {r.status === "DECLARED" ? (
                  actionButtons(r)
                ) : (
                  <button
                    type="button"
                    onClick={() => { setArmed(null); setOpenId(r.id); }}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-(--border-default) text-sm font-black text-(--text-secondary) transition-colors group-hover:border-(--brand-500) group-hover:text-(--brand-600)"
                  >
                    <Printer size={15} /> {labels.view}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {visible.length === 0 && (
        <p className="rounded-2xl border border-dashed border-(--border-default) p-10 text-center text-sm font-bold opacity-60">{labels.empty}</p>
      )}

      {/* request popup: the printable transfer note */}
      <Modal
        open={!!open}
        onClose={() => { setOpenId(null); setArmed(null); }}
        title={open?.number ?? ""}
        subtitle={open ? `${open.fromLocation?.name ?? ""} → ${open.toLocation?.name ?? ""}` : ""}
        icon={<Truck size={18} />}
        width="2xl"
      >
        {open && openSum && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-3 py-1 text-xs font-black", (TONE[open.status] ?? TONE.CANCELLED).chip)}>{statusLabel[open.status] ?? open.status}</span>
              <span className="rounded-lg bg-(--bg-sunken) px-2.5 py-1 text-xs font-black tabular-nums">{openSum.products} {labels.products}</span>
              <span className="rounded-lg bg-(--brand-500)/10 px-2.5 py-1 text-xs font-black tabular-nums text-(--brand-600)">{openSum.colis} {labels.colis}</span>
              <span className="rounded-lg bg-(--bg-sunken) px-2.5 py-1 text-xs font-black tabular-nums">{openSum.pieces} {labels.pieces}</span>
              <a
                href={`/${locale}/vans/orders/${open.id}/doc`}
                target="_blank"
                rel="noreferrer"
                className="ms-auto flex h-9 items-center gap-1.5 rounded-lg border border-(--border-default) px-3 text-xs font-black hover:border-(--brand-500)"
              >
                <ExternalLink size={13} /> {labels.openFull}
              </a>
            </div>
            {open.status === "DECLARED" && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="mb-2 text-xs font-black text-amber-700">{labels.waiting} · {ago(open.date)}</p>
                {actionButtons(open)}
              </div>
            )}
            {error && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-sm font-bold text-red-500" dir="ltr">{error}</p>}
            <iframe
              key={`${open.id}-${docKey}`}
              src={`/${locale}/vans/orders/${open.id}/doc?embed=1`}
              title={open.number}
              className="h-[min(72vh,900px)] w-full rounded-xl border border-(--border-default) bg-neutral-200"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
