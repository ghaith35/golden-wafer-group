"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { HandCoins, History, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/Card";
import { dzMoney, fmtDT } from "@/lib/format";
import { cn } from "@/lib/utils";

type Party = "clients" | "suppliers";
type Status = "unpaid" | "partial" | "settled";

type Row = {
  id: string;
  code: string;
  name: string;
  phone: string;
  total: number;
  paid: number;
  balance: number;
  limit?: number;
  openDocs: number;
  status: Status;
  lastActivity: string | null;
};

type PayItem = { id: string; name: string; balance: number };

type HistItem = { id: string; amount: unknown; date: string; notes: string | null };

const STATUS_COLOR: Record<Status, string> = {
  unpaid: "pill-red",
  partial: "pill-amber",
  settled: "pill-emerald",
};

const num = (v: number) => dzMoney(v);

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

export function DettesClient({ labels }: { labels: Record<string, string> }) {
  const locale = useLocale();
  const searchParams = useSearchParams();
  /// Initial tab from the sidebar entry (?party=clients|suppliers).
  const [party, setParty] = useState<Party>(() =>
    searchParams.get("party") === "suppliers" ? "suppliers" : "clients"
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<"" | Status>("");
  const [paying, setPaying] = useState<PayItem | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hist, setHist] = useState<HistItem[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (fStatus) params.set("status", fStatus);
    if (q.trim()) params.set("search", q.trim());
    const res = await fetch(`/api/debts/${party}?${params.toString()}`, { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      setRows(d.rows ?? []);
    }
  }, [party, fStatus, q]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  // Sidebar entries link here with ?party=… : follow it when it changes
  // (same page, no remount) so the highlight stays correct.
  useEffect(() => {
    const v = searchParams.get("party");
    if (v === "suppliers" || v === "clients") {
      setParty((cur) => {
        if (cur !== v) {
          setFStatus("");
          setQ("");
          setExpanded(null);
        }
        return v;
      });
    }
  }, [searchParams]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { unpaid: 0, partial: 0, settled: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);
  const openTotal = useMemo(() => rows.reduce((s, r) => s + r.balance, 0), [rows]);

  async function openHistory(r: Row) {
    if (expanded === r.id) {
      setExpanded(null);
      return;
    }
    setExpanded(r.id);
    setHist([]);
    const key = party === "clients" ? "clientId" : "supplierId";
    const res = await fetch(`/api/versements?${key}=${r.id}`, { cache: "no-store" });
    if (res.ok) setHist(await res.json());
  }

  function startPay(r: Row) {
    setPaying({ id: r.id, name: r.name, balance: r.balance });
    setAmount(r.balance > 0 ? String(Math.round(r.balance * 100) / 100) : "");
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setError(null);
  }

  async function confirmPay() {
    if (!paying) return;
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) {
      setError("bad_amount");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body =
        party === "clients"
          ? { clientId: paying.id, amount: val, date, notes: notes || null }
          : { supplierId: paying.id, amount: val, date, notes: notes || null };
      const res = await fetch(`/api/debts/${party}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        const code = d?.error as string | undefined;
        setError(code === "overpayment" ? labels.overpayment : code === "no_balance" ? labels.noBalance : code ?? "failed");
        return;
      }
      setPaying(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="grid grid-cols-2 gap-2">
        <KpiCard
          label={labels.balance}
          value={num(openTotal)}
          icon={<Wallet size={18} />}
          accent="bg-red-500/15 text-red-500"
          compact
        />
        <KpiCard
          label={party === "clients" ? labels.clients : labels.suppliers}
          value={String(rows.length)}
          icon={<HandCoins size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="flex-1">
          <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {(["", "unpaid", "partial", "settled"] as const).map((s) => (
            <button
              key={s || "all"}
              onClick={() => setFStatus(s)}
              className={cn(
                "flex-1 min-h-11 rounded-lg px-3 py-2 text-[12px] font-black lg:flex-none",
                fStatus === s ? "bg-(--brand-500)/10 text-(--brand-600)" : "bg-(--bg-sunken) opacity-60"
              )}
            >
              {s ? `${labels[s]} (${s ? counts[s] : rows.length})` : `${labels.all} (${rows.length})`}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}

      <div className="grid items-start gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{r.name}</div>
                <div className="truncate font-mono text-[11px] opacity-50" dir="ltr">
                  {r.code}{r.phone ? ` · ${r.phone}` : ""}
                </div>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-black", STATUS_COLOR[r.status])}>
                {labels[r.status]}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
                <div className="text-[10px] font-bold uppercase opacity-50">{labels.total}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px]">{num(r.total)}</div>
              </div>
              <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
                <div className="text-[10px] font-bold uppercase opacity-50">{labels.paid}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px] text-emerald-600">{num(r.paid)}</div>
              </div>
              <div className="rounded-lg bg-(--bg-sunken) px-1 py-1.5">
                <div className="text-[10px] font-bold uppercase opacity-50">{labels.balance}</div>
                <div className="text-xs font-black tabular-nums sm:text-[13px] text-red-500">{num(r.balance)}</div>
              </div>
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] font-bold opacity-60">
              <span>{labels.openDocs}: {r.openDocs}</span>
              <span>{r.lastActivity ? <>{labels.lastActivity}: <bdi>{fmtDT(r.lastActivity, locale)}</bdi></> : ""}</span>
            </div>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => startPay(r)} disabled={r.balance <= 0} className="flex-1">
                <HandCoins size={14} className="me-1" />
                {labels.pay}
              </Button>
              <Button variant="secondary" onClick={() => void openHistory(r)} className="flex-1">
                <History size={14} className="me-1" />
                {labels.history}
              </Button>
            </div>
            {expanded === r.id && (
              <div className="mt-2 space-y-1 border-t border-(--border-subtle) pt-2">
                {hist.length === 0 && <p className="text-xs opacity-50">{labels.empty}</p>}
                {hist.slice(0, 10).map((h) => (
                  <div key={h.id} className="flex justify-between text-xs">
                    <span className="opacity-60">
                      <bdi>{fmtDT(h.date, locale)}</bdi>{h.notes ? <span> · <bdi dir="auto">{h.notes}</bdi></span> : ""}
                    </span>
                    <span className="font-black tabular-nums text-emerald-600">{num(Number(h.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        title={labels.payTitle}
        subtitle={paying?.name ?? ""}
        icon={<HandCoins size={18} />}
      >
        {error && <p className="mb-2 rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
        <p className="mb-2 text-xs opacity-60">{labels.appliedTo}</p>
        <div className="grid gap-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.amount}</label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.date}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaying(null)} disabled={saving}>
              {labels.cancel}
            </Button>
            <Button onClick={() => void confirmPay()} disabled={saving}>
              {saving ? "…" : labels.save}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
