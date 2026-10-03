"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { dzMoney } from "@/lib/format";

type Row = { id: string; number: string; total: unknown; date: unknown; client: { name: string } | null };

/// Step 5 — inspect old factures, view or cancel them.
export function FacturesClient({
  locale,
  day,
  rows: initial,
  labels,
}: {
  locale: string;
  day: string;
  rows: Row[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [deleting, setDeleting] = useState<Row | null>(null);

  async function confirmDelete() {
    if (!deleting) return;
    await fetch(`/api/sales/${deleting.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setDeleting(null);
    setRows((prev) => prev.filter((r) => r.id !== deleting.id));
  }

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
        <h1 className="text-lg font-black">{labels.factures} ({rows.length})</h1>
      </div>
      <div className="space-y-1.5">
        {rows.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{t.number} · {t.client?.name ?? ""}</div>
              <div className="text-[11px] opacity-60">
                {new Date(t.date as string).toLocaleDateString(locale)} · <b className="tabular-nums">{dzMoney(Number(t.total))}</b>
              </div>
            </div>
            <Link href={`/${locale}/sales/${t.id}`} className="shrink-0 rounded-lg bg-(--bg-sunken) px-3 py-2 text-xs font-black">
              {labels.viewSale}
            </Link>
            <button onClick={() => setDeleting(t)} aria-label={labels.deleteSale} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={labels.confirmDelete} subtitle={deleting?.number ?? ""} icon={<Trash2 size={18} />}>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)} className="flex-1">{labels.no}</Button>
          <Button onClick={() => void confirmDelete()} className="flex-1">{labels.yes}</Button>
        </div>
      </Modal>
    </div>
  );
}
