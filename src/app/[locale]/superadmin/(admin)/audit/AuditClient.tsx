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

/// Who did what: newest first, text filter, pages of 20.
export function AuditClient({ labels }: { labels: Record<string, string> }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);

  const load = useCallback(async () => {
    const res = await fetch(`/api/superadmin/audit?q=${encodeURIComponent(q)}&page=${page}`, { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      setRows(d.rows ?? []);
      setPages(d.pages ?? 1);
    }
  }, [q, page]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  return (
    <div className="space-y-2">
      <Input placeholder={labels.search} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-black">{labels[r.action] ?? r.action}</span>
            <span className="shrink-0 tabular-nums opacity-60" dir="ltr">
              {new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="mt-0.5 truncate opacity-60" dir="auto">
            {r.admin.username}
            {r.targetType ? ` · ${r.targetType}` : ""}
            {r.targetId ? ` · ${r.targetId.slice(-6)}` : ""}
            {r.ip ? ` · ${r.ip}` : ""}
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="h-9 px-3 text-xs">‹</Button>
          <span className="text-xs font-bold tabular-nums" dir="ltr">{page + 1} / {pages}</span>
          <Button variant="secondary" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="h-9 px-3 text-xs">›</Button>
        </div>
      )}
    </div>
  );
}
