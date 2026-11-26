"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banknote, Bus, Check, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/Card";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ErrText } from "@/components/ui/ErrText";
type CloseInfo = {
  id: string;
  status: "DECLARED" | "CLOSED";
  declaredById: string | null;
  declaredAt: unknown;
  closedById: string | null;
  closedAt: unknown;
  notes: string | null;
};

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
  close: CloseInfo | null;
};

type Van = { id: string; name: string; matricule: string | null; driver: string | null };

const num = (v: number) => dzMoney(v);
const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "brand" | "red" | "green" | "plain" }) {
  return (
    <div className={cn(
      "rounded-lg px-1.5 py-1.5",
      tone === "brand" ? "bg-(--brand-500)/10" : tone === "red" ? "bg-red-500/10" : tone === "green" ? "bg-emerald-500/10" : "bg-(--bg-sunken)"
    )}>
      <div className="break-words text-[11px] font-black uppercase leading-tight opacity-60">{label}</div>
      <div className={cn(
        "break-words text-[13px] font-black tabular-nums",
        tone === "brand" ? "text-(--brand-600)" : tone === "red" ? "text-red-500" : tone === "green" ? "text-emerald-600" : ""
      )} dir="ltr">
        {value}
      </div>
    </div>
  );
}

/// صندوق اليوم: presence-style month grid, cash math per van-day.
export function CashDailyClient({
  locale,
  year,
  month,
  years,
  months,
  vans,
  rows,
  isAdmin,
  labels,
}: {
  locale: string;
  year: number;
  month: number;
  years: number[];
  months: number[];
  vans: Van[];
  rows: Row[];
  isAdmin: boolean;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dayIso, setDayIso] = useState(() => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() + 1 === month
      ? `${year}-${String(month).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
      : "";
  });
  const [modal, setModal] = useState<null | { kind: "declare" | "remit" | "close"; row: Row }>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goSeason(y: number, m: number) {
    router.push(`/${locale}/cash-daily?year=${y}&month=${m}`);
  }

  const monthName = (m: number) => {
    try {
      return new Date(year, m - 1, 1).toLocaleDateString(locale, { month: "long" });
    } catch {
      return String(m);
    }
  };

  const monthDays = useMemo(() => {
    const out: Date[] = [];
    const d = new Date(year, month - 1, 1);
    while (d.getMonth() + 1 === month) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [year, month]);

  const isoOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const vanById = useMemo(() => new Map(vans.map((v) => [v.id, v])), [vans]);

  const visible = rows.filter((r) => {
    if (dayIso && r.dayIso !== dayIso) return false;
    if (!q) return true;
    const v = vanById.get(r.vanId);
    return (v?.name ?? "").includes(q) || (v?.driver ?? "").includes(q);
  });

  const openModal = (kind: "declare" | "remit" | "close", row: Row) => {
    setModal({ kind, row });
    // Receiving: pre-fill what is still owed (never negative); declaring: the
    // driver's own counted amount.
    const remaining = Math.max(0, Math.round((row.dueCash - row.remitted) * 100) / 100);
    setAmount(kind === "remit" ? (remaining > 0 ? String(remaining) : "") : row.declared != null ? String(row.declared) : "");
    setNotes("");
    setError(null);
  };

  async function submit() {
    if (!modal) return;
    const { kind, row } = modal;
    if (kind === "declare" && !(Number(amount) >= 0 && amount !== "")) {
      setError("bad_amount");
      return;
    }
    if (kind === "remit" && !(Number(amount) > 0)) {
      setError("bad_amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = kind === "declare" ? "/api/cash-daily/declare" : kind === "remit" ? "/api/cash-daily/remit" : "/api/cash-daily/close";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vanId: row.vanId, date: row.dayIso, amount: Number(amount || 0), notes: notes || null }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      setModal(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reopen(row: Row) {
    setBusy(true);
    try {
      await fetch("/api/cash-daily/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vanId: row.vanId, date: row.dayIso }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const pill = (r: Row) => {
    const st = r.close?.status;
    return (
      <span className={cn(
        "shrink-0 rounded-full px-2 py-1 text-[11px] font-black",
        st === "CLOSED" ? "bg-(--bg-sunken) opacity-60"
        : st === "DECLARED" ? "bg-amber-500/15 text-amber-600"
        : "bg-sky-500/15 text-sky-600"
      )}>
        {st === "CLOSED" ? labels.stClosed : st === "DECLARED" ? labels.stDeclared : labels.stOpen}
      </span>
    );
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="grid grid-cols-3 gap-2">
        <KpiCard
          label={labels.collected}
          value={num(visible.reduce((s, r) => s + Number(r.collected ?? 0), 0))}
          icon={<Banknote size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact valueClassName="whitespace-normal! text-clip! break-words leading-tight" />
        <KpiCard
          label={labels.dueCash}
          value={num(visible.reduce((s, r) => s + Number(r.dueCash ?? 0), 0))}
          icon={<Wallet size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact valueClassName="whitespace-normal! text-clip! break-words leading-tight" />
        <KpiCard
          label={labels.declared}
          value={String(visible.filter((r) => r.declared != null).length)}
          icon={<Check size={18} />}
          accent="bg-violet-500/15 text-violet-500"
          compact valueClassName="whitespace-normal! text-clip! break-words leading-tight" />
      </div>
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="flex flex-1 flex-wrap gap-2">
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <Input placeholder={labels.van} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            value={year}
            onChange={(e) => { setDayIso(""); goSeason(Number(e.target.value), month); }}
            className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
            aria-label="year"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={month}
            onChange={(e) => { setDayIso(""); goSeason(year, Number(e.target.value)); }}
            className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm font-bold outline-none focus:border-(--brand-500)"
            aria-label="month"
          >
            {months.map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {monthDays.map((d) => {
          const iso = isoOf(d);
          const active = dayIso === iso;
          return (
            <button
              key={iso}
              onClick={() => setDayIso(active ? "" : iso)}
              className={cn(
                "flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center rounded-xl border px-2",
                active
                  ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                  : "border-(--border-default) opacity-70"
              )}
            >
              <span className="text-[11px] font-black">{d.toLocaleDateString(locale, { weekday: "short" })}</span>
              <span className="text-sm font-black tabular-nums">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => {
          const v = vanById.get(r.vanId);
          const closed = r.close?.status === "CLOSED";
          const declared = r.close?.status === "DECLARED";
          return (
            <div key={`${r.vanId}|${r.dayIso}`} className="min-w-0 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken)">
                  <Bus size={17} />
                </span>
                <div className="min-w-[7rem] flex-1">
                  <div className="truncate text-sm font-black">{v?.name ?? r.vanId.slice(-4)}</div>
                  <div className="truncate text-[11px] opacity-60">
                    {new Date(`${r.dayIso}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" })}
                    {v?.driver ? ` · ${v.driver}` : ""}
                  </div>
                </div>
                {pill(r)}
              </div>
              <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-1.5 text-center">
                <Metric label={labels.expected} value={num(r.expected)} />
                <Metric label={labels.collected} value={num(r.collected)} tone="green" />
                <Metric label={labels.credit} value={num(r.dueTotal)} tone={r.dueTotal > 0 ? "red" : "plain"} />
                {r.clientPayments > 0 && <Metric label={labels.clientPayments} value={num(r.clientPayments)} tone="green" />}
                {r.expenses > 0 && <Metric label={labels.expenses} value={num(r.expenses)} tone="red" />}
                {r.returnsCash > 0 && <Metric label={labels.returnsCash} value={num(r.returnsCash)} tone="red" />}
                <div className="col-span-full">
                  <Metric label={labels.dueCash} value={num(r.dueCash)} tone="brand" />
                </div>
              </div>
              <div className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-1.5 text-center">
                <Metric label={labels.declared} value={r.declared != null ? num(r.declared) : "—"} />
                <Metric label={labels.remitted} value={num(r.remitted)} />
                <Metric
                  label={labels.difference}
                  value={`${r.difference > 0 ? "+" : ""}${num(r.difference)}`}
                  tone={r.difference === 0 ? "green" : r.difference < 0 ? "red" : "brand"}
                />
              </div>
              <div className="mt-1 text-[11px] opacity-60">
                {r.salesCount} {labels.sales}
                {r.close?.notes ? ` · ${r.close.notes}` : ""}
              </div>
              {!closed && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button variant="secondary" onClick={() => openModal("declare", r)} className="min-w-[6rem] flex-1">
                    {labels.declare}
                  </Button>
                  {isAdmin && (
                    <>
                      <Button variant="secondary" onClick={() => openModal("remit", r)} className="min-w-[6rem] flex-1" data-testid="cash-remit-btn">
                        {labels.remit} · <bdi dir="ltr">{num(Math.max(0, r.dueCash - r.remitted))}</bdi>
                      </Button>
                      <Button onClick={() => openModal("close", r)} className="min-w-[6rem] flex-1">
                        {labels.close}
                      </Button>
                    </>
                  )}
                </div>
              )}
              {closed && isAdmin && (
                <div className="mt-2">
                  <Button variant="secondary" onClick={() => void reopen(r)} disabled={busy} className="w-full">
                    {labels.reopen}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal ? (modal.kind === "declare" ? labels.declare : modal.kind === "remit" ? labels.remit : labels.close) : ""}
        icon="💵"
        width="sm"
      >
        {modal && (
          <div className="space-y-3">
            <div className="rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
              {vanById.get(modal.row.vanId)?.name} · {modal.row.dayIso} · {labels.dueCash}: {num(modal.row.dueCash)}
            </div>
            {modal.kind === "remit" && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-1.5 text-center">
                {([
                  [labels.declared, modal.row.declared != null ? num(modal.row.declared) : "—"],
                  [labels.remitted, num(modal.row.remitted)],
                  [labels.remaining ?? labels.difference, num(Math.max(0, modal.row.dueCash - modal.row.remitted))],
                ] as Array<[string, string]>).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-(--bg-sunken) px-1.5 py-2">
                    <div className="break-words text-[11px] font-black uppercase leading-tight opacity-60">{k}</div>
                    <div className="break-words text-sm font-black tabular-nums" dir="ltr">{v}</div>
                  </div>
                ))}
              </div>
            )}
            {modal.kind !== "close" && (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.amount}</label>
                <Input
                  type="number" min={0} step="any" value={amount}
                  onChange={(e) => setAmount(e.target.value)} dir="ltr" inputMode="decimal"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
            {modal.kind === "remit" && (
              <Link href={`/${locale}/cash-daily/${modal.row.vanId}/${modal.row.dayIso}`} className="flex min-h-11 items-center justify-center text-center text-xs font-black text-(--brand-600) underline">
                {labels.history}
              </Link>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setModal(null)} className="flex-1">{labels.cancel}</Button>
              <Button onClick={() => void submit()} disabled={busy} className="flex-[2]">
                {busy ? "…" : labels.save}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
