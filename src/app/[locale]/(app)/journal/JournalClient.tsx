"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

type Journal = {
  salesByDay: Record<string, number>;
  paidByDay: Record<string, number>;
  versementsByDay: Record<string, number>;
  expensesByDay: Record<string, number>;
  perVan: Record<string, Record<string, number>>;
  locations: Array<{ id: string; name: string; kind: string }>;
  monthTotal: { sales: number; paid: number; versements: number; expenses: number };
};

export function JournalClient({ labels }: { labels: Record<string, string> }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Journal | null>(null);

  useEffect(() => {
    const [y, m] = month.split("-");
    fetch(`/api/journal?year=${y}&month=${Number(m)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [month]);

  const days = data
    ? [...new Set([
        ...Object.keys(data.salesByDay),
        ...Object.keys(data.versementsByDay),
        ...Object.keys(data.expensesByDay),
      ])].sort().reverse()
    : [];
  const lname = (id: string) => data?.locations.find((l) => l.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">📓 {labels.title}</h1>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {data && (
        <Card>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div><div className="text-xs opacity-60">{labels.sales}</div><div className="font-black">{data.monthTotal.sales.toFixed(0)}</div></div>
            <div><div className="text-xs opacity-60">{labels.paid}</div><div className="font-black">{data.monthTotal.paid.toFixed(0)}</div></div>
            <div><div className="text-xs opacity-60">{labels.versements}</div><div className="font-black">{data.monthTotal.versements.toFixed(0)}</div></div>
            <div><div className="text-xs opacity-60">{labels.expenses}</div><div className="font-black text-red-500">{data.monthTotal.expenses.toFixed(0)}</div></div>
          </div>
        </Card>
      )}
      {days.map((d) => (
        <Card key={d}>
          <div className="mb-1 text-sm font-black">{d}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-center text-sm">
            <div><div className="text-[11px] opacity-60">{labels.sales}</div><div className="font-bold">{(data!.salesByDay[d] ?? 0).toFixed(0)}</div></div>
            <div><div className="text-[11px] opacity-60">{labels.paid}</div><div className="font-bold">{(data!.paidByDay[d] ?? 0).toFixed(0)}</div></div>
            <div><div className="text-[11px] opacity-60">{labels.versements}</div><div className="font-bold">{(data!.versementsByDay[d] ?? 0).toFixed(0)}</div></div>
            <div><div className="text-[11px] opacity-60">{labels.expenses}</div><div className="font-bold text-red-500">{(data!.expensesByDay[d] ?? 0).toFixed(0)}</div></div>
          </div>
          {data!.perVan[d] && (
            <div className="mt-1 border-t border-(--border-subtle) pt-1 text-xs">
              {Object.entries(data!.perVan[d]).map(([lid, total]) => (
                <div key={lid} className="flex justify-between">
                  <span>🚚 {lname(lid)}</span><span className="font-bold">{total.toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
