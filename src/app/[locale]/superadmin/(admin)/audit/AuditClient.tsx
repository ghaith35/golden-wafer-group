"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Entry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  admin: { username: string };
};

/// Who did what (repaire-style table): search + date range + numbered pages.
export function AuditClient({ labels }: { labels: Record<string, string> }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const sp = new URLSearchParams({ q, page: String(p), from, to });
        const res = await fetch(`/api/superadmin/audit?${sp.toString()}`, { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          setRows(d.rows ?? []);
          setTotal(d.total ?? 0);
          setPages(d.pages ?? 1);
        }
      } finally {
        setLoading(false);
      }
    },
    [q, from, to]
  );

  useEffect(() => {
    const id = window.setTimeout(() => void load(page), q || page > 0 ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, page, q]);

  function handleFilter() {
    setPage(0);
    void load(0);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-(--text-primary)">{labels.title}</h1>
        <p className="text-sm text-(--text-secondary)">
          {labels.entriesLine.replace("{total}", String(total))}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder={labels.search}
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            onKeyDown={(e) => e.key === "Enter" && handleFilter()}
          />
        </div>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-11 rounded-lg border border-(--border-default) bg-(--bg-overlay) px-3 text-sm text-(--text-primary)"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-11 rounded-lg border border-(--border-default) bg-(--bg-overlay) px-3 text-sm text-(--text-primary)"
        />
        <Button onClick={handleFilter} className="shrink-0">
          {labels.filter}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-(--border-default) bg-(--bg-overlay) shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-(--border-default) bg-(--bg-sunken)">
              <th className="px-4 py-3 text-start font-medium text-(--text-secondary)">{labels.colWhen}</th>
              <th className="px-4 py-3 text-start font-medium text-(--text-secondary)">{labels.colUser}</th>
              <th className="px-4 py-3 text-start font-medium text-(--text-secondary)">{labels.colAction}</th>
              <th className="px-4 py-3 text-start font-medium text-(--text-secondary)">{labels.colEntity}</th>
              <th className="px-4 py-3 text-start font-medium text-(--text-secondary)">{labels.colDetails}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border-default)">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-(--text-secondary)">
                  …
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-(--text-secondary)">
                  {labels.empty}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-(--bg-sunken)/60">
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-(--text-secondary)" dir="ltr">
                    {new Date(r.createdAt).toLocaleDateString()}{" "}
                    {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-xs text-(--text-primary)" dir="auto">
                    {r.admin.username}
                  </td>
                  <td className="px-4 py-3 font-medium text-(--text-primary)">{labels[r.action] ?? r.action}</td>
                  <td className="px-4 py-3 text-xs text-(--text-secondary)" dir="ltr">
                    {r.targetType ? `${r.targetType}: ${r.targetId?.slice(0, 8) ?? ""}…` : "—"}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-(--text-secondary)" dir="ltr">
                    {r.meta && Object.keys(r.meta).length > 0 ? JSON.stringify(r.meta).slice(0, 100) : r.ip ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: Math.min(pages, 20) }, (_, i) => i).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`h-8 w-8 rounded-md text-sm font-medium ${
                p === page
                  ? "bg-(--brand-500) text-white"
                  : "border border-(--border-default) text-(--text-primary) hover:bg-(--bg-sunken)"
              }`}
            >
              {p + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
