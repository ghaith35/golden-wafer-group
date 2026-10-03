"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string; number: string; status: string; total: unknown; date: unknown;
  client: { name: string; code: string } | null;
  _count: { lines: number };
};

/// Livreur commandes: his van's open orders → tap to deliver in sales detail.
export function VanOrdersClient({
  locale,
  day,
  rows,
  labels,
}: {
  locale: string;
  day: string;
  rows: Row[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => router.push(`/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <h1 className="text-lg font-black">{labels.title ?? labels.commandes} ({rows.length})</h1>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/${locale}/sales/${r.id}`}
            className="flex items-center gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">{r.status === "CONFIRMED" ? "📦 " : ""}{r.number} · {r.client?.name ?? "—"}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] opacity-60">
                <span className={cn(
                  "rounded-full px-1.5 py-px text-[10px] font-black",
                  r.status === "DRAFT" ? "bg-amber-500/10 text-amber-600" : "bg-sky-500/10 text-sky-600"
                )}>
                  {r.status}
                </span>
                <span className="tabular-nums">{r._count.lines}</span>
              </div>
            </div>
            <div className="shrink-0 text-sm font-black tabular-nums" dir="ltr">{dzMoney(Number(r.total))}</div>
          </Link>
        ))}
        {rows.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
    </div>
  );
}
