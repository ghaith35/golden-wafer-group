"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BackButton } from "@/components/ui/BackButton";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type Row = {
  vanId: string;
  dayIso: string;
  expected: number;
  collected: number;
  dueTotal: number;
  clientPayments: number;
  expenses: number;
  returnsCash: number;
  dueCash: number;
  declared: number | null;
  remitted: number;
  difference: number;
  salesCount: number;
  close: { status: string; notes: string | null } | null;
};

type Remit = { id: string; amount: unknown; date: string; notes: string | null };

const num = (v: number) => dzMoney(v);

function Metric({ label, value, tone }: { label: string; value: string; tone?: "brand" | "red" | "green" | "plain" }) {
  return (
    <div className={cn(
      "rounded-xl px-2.5 py-2",
      tone === "brand" ? "bg-(--brand-500)/10" : tone === "red" ? "bg-red-500/10" : tone === "green" ? "bg-emerald-500/10" : "bg-(--bg-sunken)"
    )}>
      <div className="truncate text-[10px] font-black uppercase opacity-60">{label}</div>
      <div className={cn(
        "truncate text-base font-black tabular-nums",
        tone === "brand" ? "text-(--brand-600)" : tone === "red" ? "text-red-500" : tone === "green" ? "text-emerald-600" : ""
      )} dir="ltr">
        {value}
      </div>
    </div>
  );
}

/// Van-day handover as a section (no popups): breakdown, remittance history
/// with delete, and inline declare / remit / close forms.
export function HandoverClient({
  locale,
  van,
  dayIso,
  row,
  remits: initialRemits,
  isAdmin,
  labels,
}: {
  locale: string;
  van: { id: string; name: string; matricule: string | null };
  dayIso: string;
  row: Row | null;
  remits: Remit[];
  isAdmin: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = row?.close?.status === "CLOSED";
  const remaining = Math.max(0, (row?.dueCash ?? 0) - (row?.remitted ?? 0));

  async function act(kind: "declare" | "remit" | "close" | "reopen", amountOverride?: string) {
    const val = amountOverride ?? amount;
    if (kind !== "reopen" && kind !== "close" && !(Number(val) >= 0 && val !== "")) {
      setError("bad_amount");
      return;
    }
    if (kind === "remit" && !(Number(val) > 0)) {
      setError("bad_amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url =
        kind === "declare" ? "/api/cash-daily/declare"
        : kind === "remit" ? "/api/cash-daily/remit"
        : kind === "close" ? "/api/cash-daily/close" : "/api/cash-daily/reopen";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vanId: van.id, date: dayIso, amount: Number(val || 0), notes: notes || null }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      setAmount("");
      setNotes("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteRemit(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/versements/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/cash-daily`} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-black">{labels.title}</h1>
          <p className="text-sm opacity-60" dir="auto">
            {van.name} · {dayIso}
          </p>
        </div>
        {row && (
          <span className={cn(
            "rounded-full px-3 py-1 text-xs font-black",
            closed ? "bg-(--bg-sunken) opacity-60" : row.declared != null ? "pill-sky" : "pill-amber"
          )}>
            {closed ? labels.stClosed : row.declared != null ? labels.stDeclared : labels.stOpen}
          </span>
        )}
      </div>

      {!row ? (
        <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label={labels.expected} value={num(row.expected)} />
            <Metric label={labels.collected} value={num(row.collected)} tone="green" />
            <Metric label={labels.credit} value={num(row.dueTotal)} tone={row.dueTotal > 0 ? "red" : "plain"} />
            {row.clientPayments > 0 && <Metric label={labels.clientPayments} value={num(row.clientPayments)} tone="green" />}
            {row.expenses > 0 && <Metric label={labels.expenses} value={num(row.expenses)} tone="red" />}
            {row.returnsCash > 0 && <Metric label={labels.returnsCash} value={num(row.returnsCash)} tone="red" />}
            <Metric label={labels.dueCash} value={num(row.dueCash)} tone="brand" />
            <Metric label={labels.declared} value={row.declared != null ? num(row.declared) : "—"} />
            <Metric label={labels.remitted} value={num(row.remitted)} />
            <Metric label={labels.remaining} value={num(remaining)} tone={remaining > 0 ? "red" : "green"} />
            <Metric label={labels.difference} value={`${row.difference > 0 ? "+" : ""}${num(row.difference)}`} tone={row.difference === 0 ? "green" : row.difference < 0 ? "red" : "brand"} />
            <Metric label={labels.sales} value={String(row.salesCount)} />
          </div>

          <section className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
            <h2 className="mb-2 text-sm font-black">
              {labels.history} · {labels.remitted}: <bdi dir="ltr">{num(row.remitted)}</bdi>
            </h2>
            {initialRemits.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
            <div className="space-y-1.5">
              {initialRemits.map((v) => (
                <div key={v.id} className="flex items-center gap-2 rounded-xl bg-(--bg-sunken) px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold" dir="auto">
                      {v.notes || new Date(v.date).toLocaleDateString(locale)}
                    </div>
                    <div className="text-[11px] tabular-nums opacity-60" dir="ltr">{num(Number(v.amount))}</div>
                  </div>
                  {isAdmin && !closed && (
                    <button
                      type="button"
                      onClick={() => void deleteRemit(v.id)}
                      disabled={busy}
                      aria-label="delete"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {!closed ? (
            <section className="space-y-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.amount}</label>
                  <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" inputMode="decimal" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
                </div>
              </div>
              {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAmount(row.declared != null ? String(row.declared) : "");
                    void act("declare");
                  }}
                  disabled={busy}
                  className="flex-1"
                >
                  {labels.declare}
                </Button>
                {isAdmin && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const v = amount === "" ? String(remaining) : amount;
                        setAmount(v);
                        void act("remit", v);
                      }}
                      disabled={busy}
                      className="flex-1"
                    >
                      {labels.remit} · <bdi dir="ltr">{num(remaining)}</bdi>
                    </Button>
                    <Button onClick={() => void act("close")} disabled={busy} className="flex-1">
                      {labels.close}
                    </Button>
                  </>
                )}
              </div>
            </section>
          ) : (
            isAdmin && (
              <Button variant="secondary" onClick={() => void act("reopen")} disabled={busy} className="w-full">
                {labels.reopen}
              </Button>
            )
          )}
        </>
      )}
    </div>
  );
}
