"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const TABS = ["debts-clients", "debts-suppliers", "margins", "vans"] as const;

export function ReportsClient({ labels }: { labels: Record<string, string> }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("debts-clients");
  const [rows, setRows] = useState<Array<Record<string, string | number>>>([]);

  useEffect(() => {
    fetch(`/api/reports?report=${tab}`)
      .then((r) => r.json())
      .then(setRows)
      .catch(() => {});
  }, [tab]);

  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">📊 {labels.title}</h1>
        <a href={`/api/reports?report=${tab}&format=csv`}>
          <Button variant="secondary">{labels.export}</Button>
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={cn("rounded-lg px-4 py-2 text-sm font-bold", tab === x ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken)")}
          >
            {labels[x]}
          </button>
        ))}
      </div>
      <Card>
        {rows.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-(--border-default) text-start text-xs uppercase opacity-60">
                {cols.map((c) => (
                  <th key={c} className="py-2 pe-3 text-start">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-(--border-subtle) last:border-0">
                  {cols.map((c) => (
                    <td key={c} className="whitespace-nowrap py-2 pe-3 tabular-nums">{String(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
