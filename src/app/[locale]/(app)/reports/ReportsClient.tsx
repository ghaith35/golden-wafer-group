"use client";

import { EmptyState } from "@/components/motion/EmptyState";
import { Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { BarChart3, Bus, Clock, Package, Trophy, Wallet } from "lucide-react";
import { KpiCard } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { useDataVersion } from "@/lib/data-sync";
import { dzMoney } from "@/lib/format";

type Van = { id: string; name: string; matricule: string };
type ProductStat = { name: string; ref: string; qty: number; revenue: number; profit: number };
type Detail = {
  van: Van;
  sales: number; total: number; paid: number; due: number;
  profit: number; expenses: number; hours: number; days: number;
  products: ProductStat[];
  top: ProductStat | null;
};

/// Admin sales-by-van: every van as a button, then one van's sales, profit,
/// expenses, work hours, products sold and top product. Admin-only page
/// (proxy). No CSV export, no debt/margin tabs (removed per admin decision).
export function ReportsClient({ labels }: { labels: Record<string, string> }) {
  const [vans, setVans] = useState<Van[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  const dataV = useDataVersion();
  useEffect(() => {
    fetch("/api/reports?report=vans", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (Array.isArray(d)) {
          setVans(d);
          if (d.length === 1) setSelected(d[0].id);
        }
      })
      .catch(() => {});
  }, [dataV]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetch(`/api/reports?report=van-detail&van=${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.van) setDetail(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selected, dataV]);

  const money = (n: number) => dzMoney(n);

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="flex flex-wrap gap-2">
        {vans.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setSelected(v.id)}
            data-testid={`van-${v.id}`}
            className={cn(
              "flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black",
              selected === v.id
                ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                : "border-(--border-default) bg-(--bg-overlay)"
            )}
          >
            <Bus size={16} className="shrink-0 opacity-70" />
            <span className="truncate">{v.name}</span>
            {v.matricule ? <span className="font-mono text-[11px] opacity-60" dir="ltr">{v.matricule}</span> : null}
          </button>
        ))}
        {vans.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
      </div>

      {!selected && vans.length > 0 && (
        <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">
          {labels.selectVan}
        </p>
      )}
      {loading && <p className="text-center text-sm opacity-60">…</p>}

      {detail && (
        <div className="space-y-4" data-testid="van-report">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiCard label={labels.sales} value={`${detail.sales} · ${money(detail.total)}`} icon={<BarChart3 size={18} />} accent="bg-sky-500/15 text-sky-600" compact valueClassName="whitespace-normal! text-clip! break-words leading-tight" />
            <KpiCard label={labels.profit} value={money(detail.profit)} icon={<Wallet size={18} />} accent="bg-emerald-500/15 text-emerald-600" compact valueClassName="whitespace-normal! text-clip! break-words leading-tight" />
            <KpiCard label={labels.expenses} value={money(detail.expenses)} icon={<Wallet size={18} />} accent="bg-orange-500/15 text-orange-600" compact valueClassName="whitespace-normal! text-clip! break-words leading-tight" />
            <KpiCard label={labels.hours} value={`${detail.hours} (${detail.days})`} icon={<Clock size={18} />} accent="bg-violet-500/15 text-violet-600" compact valueClassName="whitespace-normal! text-clip! break-words leading-tight" />
          </div>

          {detail.top && (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
                <Trophy size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black uppercase opacity-60">{labels.topProduct}</div>
                <div className="break-words text-base font-black leading-tight">{detail.top.name}</div>
              </div>
              <div className="max-w-[45%] shrink-0 break-words text-end text-xs font-black tabular-nums" dir="ltr">
                ×{detail.top.qty} · {money(detail.top.revenue)}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-1.5 flex items-center gap-1.5 text-sm font-black opacity-70">
              <Package size={15} /> {labels.products} ({detail.products.length})
            </h2>
            {detail.products.length > 0 ? (
              <div className="table-shell">
                <table className="min-w-[560px]">
                  <thead>
                    <tr>
                      <th>{labels.product}</th>
                      <th>{labels.qty}</th>
                      <th>{labels.sales}</th>
                      <th>{labels.profit}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.products.map((p, i) => (
                      <tr key={i}>
                        <td>{p.name}{p.ref ? <span className="opacity-50"> · {p.ref}</span> : null}</td>
                        <td className="whitespace-nowrap tabular-nums">{p.qty}</td>
                        <td className="whitespace-nowrap tabular-nums">{money(p.revenue)}</td>
                        <td className="whitespace-nowrap tabular-nums">{money(p.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={<Inbox size={30} />} title={labels.empty} className="rounded-2xl border border-dashed border-(--border-default)" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
