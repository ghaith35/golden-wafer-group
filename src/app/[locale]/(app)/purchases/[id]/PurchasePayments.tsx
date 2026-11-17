"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { dzMoney } from "@/lib/format";
import { useSyncedState } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
type Payment = { id: string; amount: unknown; date: string; notes: string | null };

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

export function PurchasePayments({
  invoiceId,
  total,
  initialPaid,
  initial,
  labels,
}: {
  invoiceId: string;
  total: number;
  initialPaid: number;
  initial: Payment[];
  labels: Record<string, string>;
}) {

  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useSyncedState(initial);
  const [paid, setPaid] = useSyncedState(initialPaid);
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, total - paid);

  async function reload() {
    const res = await fetch(`/api/purchases/${invoiceId}/payments`);
    if (res.ok) {
      const d = await res.json();
      setRows(d.payments);
      setPaid(Number(d.paid));
    } else {
      router.refresh();
    }
  }

  async function submit(payAll: boolean) {
    const value = payAll ? remaining : Number(amount);
    if (!(value > 0)) {
      setError("missing_fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/purchases/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, date }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      setAmount("");
      setCreating(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/purchases/${invoiceId}/payments/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "delete_failed");
      return;
    }
    setDeleting(null);
    await reload();
  }

  return (
    <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-black">
          {labels.payments}
          <span className="ms-2 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs">{rows.length}</span>
        </h2>
        {remaining > 0 && (
          <Button onClick={() => { setError(null); setAmount(""); setCreating(true); }} className="h-9 px-3 text-xs">
            <Plus size={14} className="me-1" />
            {labels.addPayment}
          </Button>
        )}
      </div>
      {error && !creating && <p className="mb-2 rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-(--bg-sunken) px-2 py-2">
          <div className="text-[11px] font-bold opacity-60">{labels.total}</div>
          <div className="text-xs font-black tabular-nums sm:text-sm">{dzMoney(total)}</div>
        </div>
        <div className="rounded-xl bg-(--bg-sunken) px-2 py-2">
          <div className="text-[11px] font-bold opacity-60">{labels.paid}</div>
          <div className="text-xs font-black tabular-nums text-emerald-600 sm:text-sm">{dzMoney(paid)}</div>
        </div>
        <div className="rounded-xl bg-(--bg-sunken) px-2 py-2">
          <div className="text-[11px] font-bold opacity-60">{labels.remaining}</div>
          <div className="text-xs font-black tabular-nums text-red-500 sm:text-sm">{dzMoney(remaining)}</div>
        </div>
      </div>
      {rows.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between border-b border-(--border-subtle) py-2 text-sm last:border-0">
          <div>
            <span className="font-black tabular-nums">{dzMoney(Number(r.amount))}</span>
            <span className="ms-2 text-xs opacity-60"><bdi>{new Date(r.date).toLocaleDateString(locale)}</bdi>{r.notes ? <span> · <bdi dir="auto">{r.notes}</bdi></span> : ""}</span>
          </div>
          <button
            onClick={() => setDeleting(r)}
            aria-label={labels.delete}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/15 text-red-500 hover:bg-red-500/25"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      <Modal open={creating} onClose={() => setCreating(false)} title={labels.addPayment} icon="+">
        <div className="grid gap-2">
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
          <Input
            type="number" min={0} step="any" placeholder={labels.amount}
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void submit(true)} disabled={saving} className="flex-1">
              {labels.payAll} ({remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })})
            </Button>
            <Button onClick={() => void submit(false)} disabled={saving} className="flex-[2]">
              {saving ? "…" : labels.save}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={labels.deleteTitle}
        message={labels.deleteMessage}
      />
    </div>
  );
}
