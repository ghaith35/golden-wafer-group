"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bus, Check, ClipboardList, Plus, Store, Wallet, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/Card";
import { SaleDocForm } from "../sales/SaleDocForm";
import { SaleActions, type SaleDetail } from "../sales/[id]/SaleActions";
import type { SaleFormData } from "../sales/saleRefs";
import { dzMoney, fmtDT } from "@/lib/format";
import { compareNatural } from "@/lib/sort";
import { getUnsyncedDocKeys } from "@/lib/sync/client";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  number: string;
  status: string;
  total: unknown;
  date: unknown;
  channel: string;
  client: { name: string; code: string } | null;
  location: { id: string; name: string; kind: string } | null;
  createdBy: { id: string; fullName: string; username: string } | null;
  _count: { lines: number };
};

const num = (v: number) => dzMoney(v);

export function CommandesClient({
  locale,
  year,
  month,
  years,
  months,
  rows: initial,
  formData,
  formLabels,
  labels,
  detailLabels,
}: {
  locale: string;
  year: number;
  month: number;
  years: number[];
  months: number[];
  rows: Row[];
  formData: SaleFormData;
  formLabels: Record<string, string>;
  labels: Record<string, string>;
  detailLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [unsynced, setUnsynced] = useState<Set<string>>(new Set());
  useEffect(() => {
    let on = true;
    const load = () => {
      getUnsyncedDocKeys().then((s) => {
        if (on) setUnsynced(s);
      }).catch(() => {});
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
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fVan, setFVan] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const vans = useMemo(() => {
    const agg = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      if (!r.location) continue;
      const e = agg.get(r.location.id) ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += Number(r.total);
      agg.set(r.location.id, e);
    }
    return (formData.locations as Array<{ id: string; name: string; kind?: string }>)
      .map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind ?? "",
        count: agg.get(l.id)?.count ?? 0,
        total: agg.get(l.id)?.total ?? 0,
      }))
      .sort((a, b) =>
        a.kind === b.kind ? compareNatural(a.name, b.name, locale) : a.kind === "VAN" ? -1 : 1
      );
  }, [rows, formData.locations, locale]);

  function goSeason(y: number, m: number) {
    router.push(`/${locale}/commandes?year=${y}&month=${m}`);
  }

  const monthName = (m: number) => {
    try {
      return new Date(year, m - 1, 1).toLocaleDateString(locale, { month: "long" });
    } catch {
      return String(m);
    }
  };

  const visible = rows.filter(
    (r) =>
      (!fStatus || r.status === fStatus) &&
      (!fVan || r.location?.id === fVan) &&
      (!q || r.number.includes(q) || (r.client?.name ?? "").includes(q))
  );

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
    setSelectedId(null);
    setDetail(null);
  }, [fVan, fStatus]);

  /// After an inline action: refresh detail + patch the sidebar row.
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
          prev.map((r) => (r.id === d.id ? { ...r, status: d.status, total: d.total } : r))
        );
      }
    } catch { /* offline */ }
  }

  const stName = (s: string) =>
    s === "DRAFT" ? labels.stDraft : s === "CONFIRMED" ? labels.stConfirmed : s === "DELIVERED" ? labels.stDelivered : s;

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-3 lg:overflow-hidden">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <KpiCard
          label={labels.stDraft}
          value={String(rows.filter((r) => r.status === "DRAFT").length)}
          icon={<ClipboardList size={18} />}
          accent="bg-amber-500/15 text-amber-600"
          compact
        />
        <KpiCard
          label={labels.stConfirmed}
          value={String(rows.filter((r) => r.status === "CONFIRMED").length)}
          icon={<Check size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
        <KpiCard
          label={labels.total}
          value={num(rows.reduce((s, r) => s + Number(r.total ?? 0), 0))}
          icon={<Wallet size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact
        />
      </div>
      <div className="flex shrink-0 flex-col gap-2 lg:flex-row">
        <div className="flex flex-1 gap-2">
          <Button onClick={() => setCreating(true)} className="h-11 shrink-0">
            <Plus size={16} className="me-1" />
            {labels.new}
          </Button>
          <div className="flex-1">
            <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            value={year}
            onChange={(e) => goSeason(Number(e.target.value), month)}
            className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
            aria-label="year"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={month}
            onChange={(e) => goSeason(year, Number(e.target.value))}
            className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
            aria-label="month"
          >
            {months.map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-1">
          {([["", labels.all], ["DRAFT", labels.stDraft], ["CONFIRMED", labels.stConfirmed], ["DELIVERED", labels.stDelivered]] as const).map(([s, name]) => (
            <button
              key={s || "all"}
              onClick={() => setFStatus(s)}
              className={cn("flex-1 rounded-lg px-3 py-2 text-[12px] font-black lg:flex-none", fStatus === s ? "bg-(--brand-500)/10 text-(--brand-600)" : "bg-(--bg-sunken) opacity-60")}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
        <button
          onClick={() => setFVan("")}
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-black",
            fVan === "" ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)" : "border-(--border-default) opacity-70 hover:opacity-100"
          )}
        >
          <Store size={12} />
          {labels.allVans}
        </button>
        {vans.map((v) => (
          <button
            key={v.id}
            onClick={() => setFVan(fVan === v.id ? "" : v.id)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-black",
              fVan === v.id ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)" : "border-(--border-default) opacity-70 hover:opacity-100"
            )}
          >
            <Bus size={12} />
            <span className="max-w-32 truncate sm:max-w-40" title={v.name}>{v.name}</span>
            <span className="rounded-full bg-(--bg-sunken) px-1 tabular-nums">{v.count}</span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
        {/* ── Sidebar: commandes ── */}
        <div className="space-y-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5 lg:h-full lg:min-h-0 lg:overflow-y-auto">
          {visible.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}
          {visible.map((r) => {
            const active = r.id === selectedId;
            return (
              <button
                key={r.id}
                onClick={() => void select(r.id)}
                className={cn(
                  "w-full rounded-xl border px-2.5 py-2 text-start transition-colors",
                  active ? "border-(--brand-500) bg-(--brand-500)/5" : "border-(--border-default) hover:border-(--brand-500)"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                    {r.number} · {r.client?.name ?? "—"}
                  </span>
                  <span className="shrink-0 text-[13px] font-black tabular-nums" dir="ltr">{num(Number(r.total))}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] opacity-60">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={cn(
                      "shrink-0 rounded-full px-1.5 py-px text-[10px] font-black",
                      r.status === "DRAFT" ? "pill-amber"
                      : r.status === "CONFIRMED" ? "pill-sky"
                      : "pill-slate"
                    )}>
                      {stName(r.status)}
                    </span>
                    {unsynced.has(r.id) && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full pill-amber px-1.5 py-px text-[10px] font-black">
                        <WifiOff size={11} />
                        {labels.unsynced ?? "…"}
                      </span>
                    )}
                    <span className="truncate">
                      {[r.createdBy?.fullName, r.location?.name].filter(Boolean).length > 0 && (
                        <bdi dir="auto">{[r.createdBy?.fullName, r.location?.name].filter(Boolean).join(" · ")} · </bdi>
                      )}
                      <bdi>{fmtDT(r.date as string, locale)}</bdi>
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{r._count.lines} {labels.lines}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Detail ── */}
        <div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-2">
          {detailLoading && !detail ? (
            <div className="h-64 animate-pulse rounded-2xl bg-(--bg-sunken)" />
          ) : detail ? (
            <SaleActions
              locale={locale}
              sale={detail}
              locations={formData.locations.map((l: { id: string; name: string; kind?: string }) => ({ id: l.id, name: l.name, kind: l.kind }))}
              labels={detailLabels}
              onDone={(id) => void detailChanged(id)}
              formData={formData}
              formLabels={formLabels}
              canEdit
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-(--border-default) p-10 text-center text-sm opacity-50">
              {labels.empty}
            </div>
          )}
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title={labels.new} subtitle={labels.title} icon="+" width="xl">
        <SaleDocForm
          locale={locale}
          mode="order"
          clients={formData.clients}
          products={formData.products}
          units={formData.units}
          tiers={formData.tiers}
          locations={formData.locations}
          remiseEnabled={formData.settings.remiseEnabled}
          creditEnabled={formData.settings.creditSalesEnabled}
          allowPieces={formData.settings.pieceSalesEnabled}
          defaultTierId={formData.tiers[0]?.id}
          onCreated={() => { setCreating(false); router.refresh(); }}
          labels={formLabels}
        />
      </Modal>
    </div>
  );
}
