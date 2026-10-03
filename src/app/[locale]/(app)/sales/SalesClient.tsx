"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bus, Plus, Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SaleDocForm } from "./SaleDocForm";
import { SaleActions, type SaleDetail } from "./[id]/SaleActions";
import type { SaleFormData } from "./saleRefs";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  number: string;
  status: string;
  total: unknown;
  paid: unknown;
  date: unknown;
  isPortal: boolean;
  offList: boolean;
  client: { name: string; code: string } | null;
  location: { id: string; name: string; matricule: string | null; kind: string } | null;
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-(--bg-sunken) text-(--text-secondary)",
  CONFIRMED: "bg-sky-500/10 text-sky-600",
  DELIVERED: "bg-indigo-500/10 text-indigo-500",
  INVOICED: "bg-violet-500/10 text-violet-500",
  CANCELLED: "bg-red-500/10 text-red-500",
};

const num = (v: number) => dzMoney(v);

export function SalesClient({
  locale,
  kind,
  year,
  month,
  day,
  days,
  years,
  months,
  rows: initial,
  formData,
  formLabels,
  labels,
  detailLabels,
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
  formData: SaleFormData;
  formLabels: Record<string, string>;
  labels: Record<string, string>;
  detailLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [modal, setModal] = useState<"ticket" | null>(null);
  const [q, setQ] = useState("");
  const [fVan, setFVan] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /// All vans/depots — even with zero sales. Counts + revenue from rows.
  const vans = useMemo(() => {
    const agg = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      if (!r.location) continue;
      const e = agg.get(r.location.id) ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += Number(r.total);
      agg.set(r.location.id, e);
    }
    return (formData.locations as Array<{ id: string; name: string; matricule?: string | null; kind?: string }>)
      .map((l) => ({
        id: l.id,
        name: l.name,
        matricule: l.matricule ?? null,
        kind: l.kind ?? "",
        count: agg.get(l.id)?.count ?? 0,
        total: agg.get(l.id)?.total ?? 0,
      }))
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "VAN" ? -1 : 1
      );
  }, [rows, formData.locations]);
  const visible = rows.filter(
    (r) =>
      (!fVan || r.location?.id === fVan) &&
      (!q || r.number.includes(q) || (r.client?.name ?? "").includes(q))
  );

  const sum = useMemo(() => {
    const total = visible.reduce((s, r) => s + Number(r.total), 0);
    const paid = visible.reduce((s, r) => s + Number(r.paid ?? 0), 0);
    return { total, paid, due: total - paid, avg: visible.length ? total / visible.length : 0 };
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

  function goSeason(y: number, m: number, d: number = day) {
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    p.set("year", String(y));
    p.set("month", String(m));
    if (d > 0) p.set("day", String(d));
    router.push(`/${locale}/sales?${p.toString()}`);
  }

  const monthName = (m: number) => {
    try {
      return new Date(year, m - 1, 1).toLocaleDateString(locale, { month: "long" });
    } catch {
      return String(m);
    }
  };

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
  }, [fVan]);

  /// After an inline action (confirm/deliver/invoice/cancel): refresh the
  /// detail and patch the sidebar row without leaving the page.
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

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-3 lg:overflow-hidden">
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" onClick={() => setModal("ticket")} className="shrink-0">
          <Plus size={16} className="me-1" />
          {labels.newTicket}
        </Button>
        <div className="flex-1">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {/* Season filter: year + month + day (weekday + number) */}
        <select
          value={year}
            onChange={(e) => goSeason(Number(e.target.value), month, 0)}
          className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
          aria-label="year"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={month}
            onChange={(e) => goSeason(year, Number(e.target.value), 0)}
          className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
          aria-label="month"
        >
          {months.map((m) => (
            <option key={m} value={m}>{monthName(m)}</option>
          ))}
        </select>
        <select
          value={day}
          onChange={(e) => goSeason(year, month, Number(e.target.value))}
          className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold tabular-nums outline-none focus:border-(--brand-500)"
          aria-label="day"
        >
          <option value={0}>{labels.all}</option>
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {new Date(year, month - 1, d).toLocaleDateString(locale, { weekday: "short" })} {d}
            </option>
          ))}
        </select>
      </div>

      {/* ── Vans as small buttons (default: all) ── */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
        <button
          onClick={() => setFVan("")}
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-black",
            fVan === ""
              ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
              : "border-(--border-default) opacity-70 hover:opacity-100"
          )}
        >
          <Store size={12} />
          {labels.allVans}
          <span className="rounded-full bg-(--bg-sunken) px-1 tabular-nums">{rows.length}</span>
        </button>
        {vans.map((v) => {
          const active = fVan === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setFVan(active ? "" : v.id)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-black",
                active
                  ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                  : "border-(--border-default) opacity-70 hover:opacity-100"
              )}
            >
              <Bus size={12} />
              <span className="max-w-32 truncate sm:max-w-40" title={v.name}>{v.name}</span>
            </button>
          );
        })}
      </div>

      {/* ── Filter summary ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-4 py-2.5 text-sm font-bold">
        <span className="opacity-60">{labels.kpiCount}: <b className="tabular-nums opacity-100">{visible.length}</b></span>
        <span className="opacity-60">{labels.total}: <b className="tabular-nums opacity-100">{num(sum.total)}</b></span>
        <span className="opacity-60">{labels.paid}: <b className="tabular-nums text-emerald-600">{num(sum.paid)}</b></span>
        <span className="opacity-60">{labels.due}: <b className="tabular-nums text-red-500">{num(sum.due)}</b></span>
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
        {/* ── Sidebar: factures (Khiata-style dense rows) ── */}
        <div className="space-y-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2.5 lg:h-full lg:min-h-0 lg:overflow-y-auto">
          {visible.length === 0 && <p className="p-1 text-sm opacity-60">{labels.empty}</p>}
          {visible.map((r) => {
            const total = Number(r.total);
            const paid = Number(r.paid ?? 0);
            const active = r.id === selectedId;
            return (
              <button
                key={r.id}
                onClick={() => void select(r.id)}
                className={cn(
                  "w-full rounded-xl border px-2.5 py-2 text-start transition-colors",
                  active
                    ? "border-(--brand-500) bg-(--brand-500)/5"
                    : "border-(--border-default) hover:border-(--brand-500)"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                    {r.number} · {r.client ? r.client.name : labels.walkin}
                  </span>
                  <span className="shrink-0 text-[13px] font-black tabular-nums">{num(total)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] opacity-60">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-black", STATUS_STYLE[r.status] ?? STATUS_STYLE.DRAFT)}>
                      {r.status}
                    </span>
                    <span className="truncate">{r.location?.name ?? ""} · {new Date(r.date as string).toLocaleDateString(locale)}</span>
                  </span>
                  {total - paid > 0.005 ? (
                    <span className="shrink-0 font-bold tabular-nums text-red-500">{num(total - paid)}</span>
                  ) : (
                    <span className="shrink-0 font-bold text-emerald-600">✓</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Detail ── */}
        <div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-2 lg:pe-0.5">
          {detailLoading && !detail ? (
            <div className="h-64 animate-pulse rounded-2xl bg-(--bg-sunken)" />
          ) : detail ? (
            <SaleActions
              locale={locale}
              sale={detail}
              locations={formData.locations.map((l: { id: string; name: string; kind?: string }) => ({ id: l.id, name: l.name, kind: l.kind }))}
              labels={detailLabels}
              onDone={(id) => void detailChanged(id)}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-(--border-default) p-10 text-center text-sm opacity-50">
              {labels.empty}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={labels.newTicket}
        subtitle={labels.title}
        icon="+"
        width="xl"
      >
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
