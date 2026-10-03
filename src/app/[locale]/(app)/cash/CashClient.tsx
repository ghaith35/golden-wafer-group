"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Plus, ArrowDownToLine, ArrowUpFromLine, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { queueOp } from "@/lib/sync/client";
import { cn } from "@/lib/utils";

type V = {
  id: string;
  kind: string;
  amount: unknown;
  date: string;
  notes: string | null;
  client: { name: string; code: string } | null;
  supplier: { name: string } | null;
  transfer: { number: string } | null;
};
type D = { id: string; amount: unknown; date: string; client: { name: string; code: string } };

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

const fmtAmount = (v: unknown) =>
  Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtTotal = (v: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string, locale: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(locale);
};

function partyName(r: V): string {
  if (r.kind === "CLIENT_PAYMENT") return r.client ? `${r.client.name}` : "";
  if (r.kind === "SUPPLIER_PAYMENT") return r.supplier?.name ?? "";
  return r.transfer ? `🚚 ${r.transfer.number}` : "";
}

export function CashClient({
  clients,
  suppliers,
  depositsOn,
  labels,
}: {
  clients: Array<{ id: string; name: string; code: string; balance: number }>;
  suppliers: Array<{ id: string; name: string; balance: number }>;
  depositsOn: boolean;
  labels: Record<string, string>;
}) {
  const locale = useLocale();
  const [tab, setTab] = useState<"v" | "d">("v");
  const [rows, setRows] = useState<V[]>([]);
  const [deps, setDeps] = useState<D[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"CLIENT_PAYMENT" | "SUPPLIER_PAYMENT">("CLIENT_PAYMENT");
  const [creating, setCreating] = useState(false);
  const [party, setParty] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [depClient, setDepClient] = useState("");
  const [depAmount, setDepAmount] = useState("");
  const [queued, setQueued] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setRows(await fetch("/api/versements").then((r) => r.json()));
    if (depositsOn) setDeps(await fetch("/api/deposits").then((r) => r.json()).catch(() => []));
  }
  useEffect(() => {
    reload().catch(() => {});
  }, []);

  async function submit() {
    if (!amount || Number(amount) <= 0 || !party) {
      setError("missing_fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        kind,
        clientId: kind === "CLIENT_PAYMENT" ? party : null,
        supplierId: kind === "SUPPLIER_PAYMENT" ? party : null,
        amount: Number(amount),
        date,
      };
      let res: Response;
      try {
        res = await fetch("/api/versements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // Offline van collection: queue the client payment, sync on reconnect.
        if (kind !== "CLIENT_PAYMENT") throw new Error("offline");
        try {
          await queueOp("versement", { clientId: party, amount: Number(amount) } as Record<string, unknown>);
        } catch {
          setError("failed");
          return;
        }
        setQueued(true);
        setAmount("");
        setParty("");
        setCreating(false);
        return;
      }
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      setAmount("");
      setParty("");
      setCreating(false);
      await reload();
    } catch {
      setError("failed");
    } finally {
      setSaving(false);
    }
  }

  async function submitDeposit() {
    if (!depClient || !depAmount || Number(depAmount) <= 0) {
      setError("missing_fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: depClient, amount: Number(depAmount), date }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      setDepAmount("");
      setCreating(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  const filteredV = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!q ||
            partyName(r).includes(q) ||
            (r.client?.code ?? "").includes(q))
      ),
    [rows, q]
  );
  const filteredD = useMemo(
    () =>
      deps.filter(
        (x) => !q || x.client.name.includes(q) || x.client.code.includes(q)
      ),
    [deps, q]
  );
  const total = useMemo(
    () =>
      (tab === "v" ? filteredV : filteredD).reduce((s, r) => s + Number(r.amount), 0),
    [tab, filteredV, filteredD]
  );

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{labels.title}</h1>
      </div>
      {error && !creating && (
        <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>
      )}
      {queued && (
        <p className="rounded-lg bg-amber-500/10 p-2 text-sm font-bold text-amber-600">{labels.queued}</p>
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 lg:flex-1">
          <Button onClick={() => { setError(null); setCreating(true); }} className="shrink-0">
            <Plus size={16} className="me-1" />
            {tab === "v" ? labels.newVersement : labels.newDeposit}
          </Button>
          <div className="flex-1">
            <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab("v")}
            className={cn("rounded-lg px-4 py-2 text-sm font-bold", tab === "v" ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken)")}
          >
            {labels.versements}
          </button>
          {depositsOn && (
            <button
              onClick={() => setTab("d")}
              className={cn("rounded-lg px-4 py-2 text-sm font-bold", tab === "d" ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken)")}
            >
              {labels.deposits}
            </button>
          )}
          {tab === "v" && (
            <div className="flex gap-1 rounded-lg bg-(--bg-sunken) p-1">
              {(["CLIENT_PAYMENT", "SUPPLIER_PAYMENT"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-bold",
                    kind === k ? "bg-(--bg-overlay) shadow" : "opacity-60"
                  )}
                >
                  {labels[k]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-4 py-3">
        <span className="text-sm font-bold opacity-80">
          {tab === "v" ? labels.versements : labels.deposits}
          <span className="ms-2 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs font-black opacity-80">
            {tab === "v" ? filteredV.length : filteredD.length}
          </span>
        </span>
        <span className="text-base font-black">
          {labels.total}: {fmtTotal(total)}
        </span>
      </div>

      {tab === "v" && (
        <div className="space-y-2">
          {filteredV.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
          {filteredV.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
                {r.kind === "CLIENT_PAYMENT" ? <ArrowDownToLine size={18} /> : r.kind === "SUPPLIER_PAYMENT" ? <ArrowUpFromLine size={18} /> : <HandCoins size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{partyName(r) || "—"}</div>
                <div className="truncate text-xs opacity-60">
                  {r.kind === "CLIENT_PAYMENT" && r.client ? (
                    <span className="font-mono">{r.client.code} · </span>
                  ) : null}
                  {fmtDate(r.date, locale)}
                </div>
              </div>
              <div className="shrink-0 text-sm font-black">{fmtAmount(r.amount)}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "d" && depositsOn && (
        <div className="space-y-2">
          {filteredD.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
          {filteredD.map((x) => (
            <div
              key={x.id}
              className="flex items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
                <HandCoins size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{x.client.name}</div>
                <div className="truncate text-xs opacity-60">
                  <span className="font-mono">{x.client.code} · </span>
                  {fmtDate(x.date, locale)}
                </div>
              </div>
              <div className="shrink-0 text-sm font-black">{fmtAmount(x.amount)}</div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={tab === "v" ? labels.newVersement : labels.newDeposit}
        subtitle={labels.title}
        icon="+"
      >
        <div className="grid gap-2">
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          {tab === "v" ? (
            <>
              <div className="flex gap-2">
                {(["CLIENT_PAYMENT", "SUPPLIER_PAYMENT"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => { setKind(k); setParty(""); }}
                    className={cn("rounded-lg px-3 py-1.5 text-sm font-bold", kind === k ? "bg-(--brand-500) text-white" : "bg-(--bg-sunken)")}
                  >
                    {labels[k]}
                  </button>
                ))}
              </div>
              <select value={party} onChange={(e) => setParty(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {(kind === "CLIENT_PAYMENT" ? clients : suppliers).map((p) => (
                  <option key={p.id} value={p.id}>
                    {"code" in p ? `${p.name} · ${p.code} · ` : `${p.name} · `}{p.balance}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" min={0} step="any" placeholder={labels.amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="mt-1 flex justify-end">
                <Button onClick={submit} disabled={saving}>{saving ? "…" : labels.newVersement}</Button>
              </div>
            </>
          ) : (
            <>
              <select value={depClient} onChange={(e) => setDepClient(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {c.code}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" min={0} step="any" placeholder={labels.amount} value={depAmount} onChange={(e) => setDepAmount(e.target.value)} />
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="mt-1 flex justify-end">
                <Button onClick={submitDeposit} disabled={saving}>{saving ? "…" : labels.newDeposit}</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
