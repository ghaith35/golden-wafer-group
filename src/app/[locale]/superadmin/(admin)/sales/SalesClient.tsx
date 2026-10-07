"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { Input } from "@/components/ui/Input";

type Company = { id: string; name: string };
type Sale = {
  id: string; companyId: string; kind: string; status: string; channel: string; number: string;
  total: string | number; paid: string | number; remise: string | number; date: string; createdAt: string;
  notes: string | null; company: { name: string }; client: { name: string; phone: string | null } | null;
  location: { name: string } | null; createdBy: { fullName: string } | null; _count: { lines: number };
};

const kinds = ["ORDER", "DELIVERY", "INVOICE", "TICKET"];
const statuses = ["DRAFT", "CONFIRMED", "DELIVERED", "INVOICED", "CANCELLED"];

export function SalesClient({ labels }: { labels: Record<string, string> }) {
  const [rows, setRows] = useState<Sale[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ page: String(page), q: query, companyId, kind, status });
      try {
        const res = await fetch(`/api/superadmin/sales?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error("load_failed");
        const data = await res.json() as { rows: Sale[]; total: number; pages: number; companies: Company[] };
        if (!cancelled) {
          setRows(data.rows);
          setTotalRows(data.total);
          setPageCount(data.pages);
          setCompanies(data.companies);
        }
      } catch {
        if (!cancelled) setError("load_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [page, query, companyId, kind, status]);

  const money = (value: string | number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const statusTone = (s: string) => s === "CANCELLED" ? "text-red-500 bg-red-500/10" : s === "DRAFT" ? "text-amber-600 bg-amber-500/10" : "text-emerald-600 bg-emerald-500/10";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-(--border-default) pb-4">
        <div><h1 className="text-xl font-black text-(--text-primary)">{labels.title}</h1><p className="mt-1 text-sm text-(--text-secondary)">{labels.subtitle}</p></div>
        <p className="text-sm font-bold tabular-nums text-(--text-secondary)">{totalRows.toLocaleString()}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="relative block text-xs font-bold text-(--text-secondary)"><span className="sr-only">{labels.search}</span><Search size={15} className="absolute inset-s-3 top-3.5" /><Input className="ps-9" placeholder={labels.search} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
        <label className="text-xs font-bold text-(--text-secondary)"><span className="sr-only">{labels.company}</span><select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(0); }} className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm text-(--text-primary)"><option value="">{labels.allCompanies}</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label className="text-xs font-bold text-(--text-secondary)"><span className="sr-only">{labels.kind}</span><select value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }} className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm text-(--text-primary)"><option value="">{labels.allKinds}</option>{kinds.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
        <label className="text-xs font-bold text-(--text-secondary)"><span className="sr-only">{labels.status}</span><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm text-(--text-primary)"><option value="">{labels.allStatuses}</option>{statuses.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{labels[error] ?? error}</p>}
      <div className="divide-y divide-(--border-default) border-y border-(--border-default)">
        {loading ? <p className="py-10 text-center text-sm text-(--text-secondary)">{labels.loading}</p> : rows.length === 0 ? <p className="py-10 text-center text-sm text-(--text-secondary)">{labels.empty}</p> : rows.map((sale) => (
          <article key={sale.id} className="py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-32 flex-1">
                <p className="font-mono text-sm font-black text-(--text-primary)" dir="ltr">{sale.number}</p>
                <p className="mt-0.5 truncate text-xs text-(--text-secondary)">{sale.company.name} · {sale.client?.name ?? "—"}{sale.client?.phone ? ` · ${sale.client.phone}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-(--bg-sunken) px-2 py-1 text-[11px] font-bold">{labels[sale.kind] ?? sale.kind}</span>
                <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${statusTone(sale.status)}`}>{labels[sale.status] ?? sale.status}</span>
              </div>
              <div className="min-w-28 text-end">
                <p className="text-sm font-black tabular-nums text-(--text-primary)" dir="ltr">{money(sale.total)} DZD</p>
                <p className="text-[11px] text-(--text-secondary)">{labels.paid}: <bdi dir="ltr">{money(sale.paid)}</bdi></p>
              </div>
              <button type="button" onClick={() => setExpanded(expanded === sale.id ? null : sale.id)} aria-label={expanded === sale.id ? labels.hideDetails : labels.showDetails} className="flex h-10 w-10 items-center justify-center rounded-lg text-(--text-secondary) hover:bg-(--bg-sunken)">
                {expanded === sale.id ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </button>
            </div>
            {expanded === sale.id && <dl className="mt-3 grid gap-x-5 gap-y-2 border-t border-(--border-subtle) pt-3 text-xs sm:grid-cols-3">
              {([[labels.date, new Date(sale.date).toLocaleString()], [labels.location, sale.location?.name ?? "—"], [labels.createdBy, sale.createdBy?.fullName ?? "—"], [labels.lines, sale._count.lines], [labels.total, `${money(sale.total)} DZD`], [labels.channel, sale.channel], [labels.notes, sale.notes ?? "—"]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-(--text-secondary)">{label}</dt><dd className="mt-0.5 truncate font-semibold text-(--text-primary)" dir="auto">{value}</dd></div>)}
            </dl>}
          </article>
        ))}
      </div>
      {pageCount > 1 && <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} className="min-h-10 rounded-lg border border-(--border-default) px-3 text-sm font-bold disabled:opacity-40">{labels.previous}</button>
        <span className="text-xs font-semibold text-(--text-secondary)">{labels.page.replace("{page}", String(page + 1)).replace("{pages}", String(pageCount))}</span>
        <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1 || loading} className="min-h-10 rounded-lg border border-(--border-default) px-3 text-sm font-bold disabled:opacity-40">{labels.next}</button>
      </div>}
    </div>
  );
}