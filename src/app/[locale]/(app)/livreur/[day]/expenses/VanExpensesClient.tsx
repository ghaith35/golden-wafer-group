"use client";

import { useCallback, useEffect, useState } from "react";
import { ApkOnly } from "@/components/layout/ApkOnly";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ExpenseTypePicker, expenseTypeStyle, type ExpenseTypeOpt } from "@/components/expenses/ExpenseTypePicker";
import { OnlineBadge } from "@/components/sync/OnlineBadge";
import { UnsyncedBadge } from "@/components/sync/UnsyncedBadge";
import {
  discardOutboxOp,
  getOutbox,
  goPage,
  queueOp,
  updateOutboxPayload,
} from "@/lib/sync/client";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/data-sync";

type ServerRow = {
  id: string;
  label: string;
  typeId?: string | null;
  description?: string | null;
  amount: unknown;
  expenseDate: string;
  opId: string | null;
};

type PendingOp = { opId: string; kind: string; payload: Record<string, unknown> };

type ViewRow = {
  key: string;
  id: string | null;
  createOpId: string | null;
  updateOpId: string | null;
  deleteOpId: string | null;
  label: string;
  typeId: string | null;
  note: string;
  amount: number;
  date: string; // YYYY-MM-DD
  pending: boolean;
};

const EXPENSE_KINDS = new Set(["expense", "expense-update", "expense-delete"]);

function dayOf(v: unknown, fallback: string): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return fallback;
}

const TYPES_CACHE = "gw-expense-types";
/// Offline: the page props are gone, so the last known type list is kept here.
function readTypesCache(): ExpenseTypeOpt[] {
  try {
    const v = JSON.parse(localStorage.getItem(TYPES_CACHE) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string" && typeof x.name === "string") : [];
  } catch {
    return [];
  }
}

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso.slice(0, 10);
}

/// Van expenses section: the driver's own list with create / edit / delete.
/// Online hits the API; offline everything queues (create / update / delete
/// ops) and pending rows wear the "not synced" badge until replay.
export function VanExpensesClient({
  locale,
  day,
  vanId,
  vanName,
  rows,
  types,
  labels,
}: {
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  rows: ServerRow[];
  types: ExpenseTypeOpt[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useSyncedState<ServerRow[]>(rows);
  const [pending, setPending] = useState<PendingOp[]>([]);
  const [online, setOnline] = useState(true);

  const [cachedTypes] = useState<ExpenseTypeOpt[]>(() => (typeof window === "undefined" ? [] : readTypesCache()));
  const typeList = types.length ? types : cachedTypes;
  useEffect(() => {
    if (!types.length) return;
    try { localStorage.setItem(TYPES_CACHE, JSON.stringify(types)); } catch { /* storage full / blocked */ }
  }, [types]);
  const typeName = (id: string | null | undefined) => (id ? typeList.find((x) => x.id === id)?.name ?? null : null);

  const [typeId, setTypeId] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [fTypeId, setFTypeId] = useState("");
  const [fNote, setFNote] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fDate, setFDate] = useState(todayLocal());
  const [confirming, setConfirming] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const ops = await getOutbox();
      setPending(
        ops
          .filter((o) => EXPENSE_KINDS.has(o.kind))
          .map((o) => ({ opId: o.opId, kind: o.kind, payload: (o.payload ?? {}) as Record<string, unknown> }))
      );
    } catch { /* outbox unreadable — server list still shows */ }
    try {
      const res = await fetch(`/api/expenses?locationId=${encodeURIComponent(vanId)}`, { cache: "no-store" });
      if (res.ok) setItems((await res.json()) as ServerRow[]);
    } catch { /* offline — keep last list + pending */ }
  }, [vanId]);

  useEffect(() => {
    try {
      setOnline(navigator.onLine);
    } catch { /* assume online */ }
    const on = () => {
      setOnline(true);
      void reload();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── merged view: server rows shadowed by pending ops ────────────────────
  const view: ViewRow[] = (() => {
    const byId = new Map<string, ViewRow>();
    for (const r of items) {
      byId.set(r.id, {
        key: `id:${r.id}`,
        id: r.id,
        createOpId: null,
        updateOpId: null,
        deleteOpId: null,
        label: r.label,
        typeId: r.typeId ?? null,
        note: r.description ?? "",
        amount: Number(r.amount ?? 0),
        date: dayOf(r.expenseDate, todayLocal()),
        pending: false,
      });
    }
    const byCreateOp = new Map<string, ViewRow>();
    for (const r of items) {
      if (r.opId) {
        const v = byId.get(r.id);
        if (v) byCreateOp.set(r.opId, v);
      }
    }
    const shadows: ViewRow[] = [];
    for (const o of pending) {
      const p = o.payload;
      if (o.kind === "expense") {
        shadows.push({
          key: `op:${o.opId}`,
          id: null,
          createOpId: o.opId,
          updateOpId: null,
          deleteOpId: null,
          label: String(p.label ?? ""),
          typeId: typeof p.typeId === "string" && p.typeId ? p.typeId : null,
          note: typeof p.description === "string" ? p.description : "",
          amount: Number(p.amount ?? 0),
          date: dayOf(p.expenseDate, todayLocal()),
          pending: true,
        });
      } else {
        const ref = typeof p.ref === "string" && p.ref ? byId.get(p.ref) : undefined;
        const opRef = typeof p.opRef === "string" && p.opRef
          ? (byCreateOp.get(p.opRef) ?? shadows.find((s) => s.createOpId === p.opRef))
          : undefined;
        const target = ref ?? opRef;
        if (!target) continue;
        target.pending = true;
        if (o.kind === "expense-update") {
          target.updateOpId = o.opId;
          if (typeof p.label === "string" && p.label) target.label = p.label;
          if (typeof p.typeId === "string" && p.typeId) target.typeId = p.typeId;
          if (typeof p.description === "string") target.note = p.description;
          if (p.amount != null && Number.isFinite(Number(p.amount))) target.amount = Number(p.amount);
          const d = dayOf(p.expenseDate, "");
          if (d) target.date = d;
        } else {
          target.deleteOpId = o.opId;
        }
      }
    }
    return [...byId.values(), ...shadows];
  })();

  const pendingOp = (opId: string | null) => pending.find((o) => o.opId === opId);

  function openEdit(row: ViewRow) {
    setEditingKey(row.key);
    setFTypeId(row.typeId ?? "");
    setFNote(row.note);
    setFAmount(String(row.amount));
    setFDate(row.date);
    setConfirming(null);
    setErr(null);
    setOkMsg(null);
  }

  async function discardRowOps(row: ViewRow) {
    // After a successful ONLINE mutation, drop any pending ops for the row
    // so replay can't re-apply stale values over the fresh server state.
    for (const opId of [row.updateOpId, row.deleteOpId]) {
      if (opId) {
        try {
          await discardOutboxOp(opId);
        } catch { /* best-effort */ }
      }
    }
  }

  function resetCreate() {
    setTypeId("");
    setNote("");
    setAmount("");
    setDate(todayLocal());
  }

  async function submitCreate() {
    const tName = typeName(typeId);
    const a = Number(amount);
    if (!typeId || !tName || !(a > 0) || busy) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    // The stored label is the type name; the optional note goes to the description.
    const body = { label: tName, typeId, description: note.trim() || null, amount: a, expenseDate: date, vanId };
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String((await res.json().catch(() => null))?.error ?? res.status));
      resetCreate();
      await reload();
    } catch {
      try {
        await queueOp("expense", { ...body });
        resetCreate();
        setOkMsg(labels.queuedOk);
        await reload();
      } catch {
        setErr(labels.failed);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(row: ViewRow) {
    // Rows from before types existed may stay type-less; any other row needs one.
    const legacy = !row.typeId;
    const tName = typeName(fTypeId);
    const a = Number(fAmount);
    if ((!fTypeId && !legacy) || !(a > 0) || busy) {
      if ((!fTypeId && !legacy) || !(a > 0)) setErr(labels.failed);
      return;
    }
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    const vals = {
      ...(fTypeId && tName ? { label: tName, typeId: fTypeId } : {}),
      description: fNote.trim(),
      amount: a,
      expenseDate: fDate,
    };
    try {
      if (row.updateOpId) {
        // Still-unsynced follow-up: rewrite the queued update in place.
        const prev = pendingOp(row.updateOpId)?.payload ?? {};
        await updateOutboxPayload(row.updateOpId, { ...prev, ...vals });
      } else if (row.createOpId) {
        // Pending create: rewrite the queued payload (keeps vanId).
        const prev = pendingOp(row.createOpId)?.payload ?? {};
        await updateOutboxPayload(row.createOpId, { ...prev, ...vals });
      } else if (row.id) {
        const res = await fetch(`/api/expenses/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(vals),
        });
        if (!res.ok) throw new Error(String((await res.json().catch(() => null))?.error ?? res.status));
        await discardRowOps(row);
      }
      setEditingKey(null);
      await reload();
    } catch {
      // Offline (or server hiccup) on a synced row → queue the update.
      if (row.id && !row.createOpId && !row.updateOpId) {
        try {
          await queueOp("expense-update", { ref: row.id, ...vals });
          setEditingKey(null);
          setOkMsg(labels.queuedOk);
          await reload();
          return;
        } catch { /* fall through to error */ }
      }
      setErr(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(row: ViewRow) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      if (row.createOpId && !row.id) {
        // Never synced: just drop the queued create (+ its queued update).
        if (row.updateOpId) {
          try {
            await discardOutboxOp(row.updateOpId);
          } catch { /* best-effort */ }
        }
        await discardOutboxOp(row.createOpId);
      } else if (row.id) {
        if (row.updateOpId) {
          try {
            await discardOutboxOp(row.updateOpId);
          } catch { /* best-effort */ }
        }
        const res = await fetch(`/api/expenses/${row.id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String((await res.json().catch(() => null))?.error ?? res.status));
        await discardRowOps(row);
      }
      setConfirming(null);
      await reload();
    } catch {
      // Offline on a synced row → queue the soft-delete.
      if (row.id && !row.createOpId) {
        try {
          if (row.updateOpId) {
            try {
              await discardOutboxOp(row.updateOpId);
            } catch { /* best-effort */ }
          }
          await queueOp("expense-delete", { ref: row.id });
          setConfirming(null);
          setOkMsg(labels.queuedOk);
          await reload();
          return;
        } catch { /* fall through to error */ }
      }
      setErr(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  async function undoDelete(row: ViewRow) {
    if (!row.deleteOpId || busy) return;
    setBusy(true);
    try {
      await discardOutboxOp(row.deleteOpId);
      await reload();
    } catch {
      setErr(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  const total = view.filter((r) => !r.deleteOpId).reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);

  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.title}</h1>
          <p className="truncate text-xs opacity-60">{vanName}</p>
        </div>
        <ApkOnly><OnlineBadge onlineLabel={labels.online} offlineLabel={labels.offline} /></ApkOnly>
      </div>

      {/* create */}
      <div className="space-y-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-sm">
        <ExpenseTypePicker
          types={typeList}
          value={typeId}
          onChange={setTypeId}
          label={labels.expenseTypes}
          required
          emptyText={labels.expenseNoTypes}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.amount}</label>
            <Input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              dir="ltr"
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.date}</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
          </div>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase opacity-60">
            {labels.expenseNote}
            <span className="rounded-full bg-(--bg-sunken) px-1.5 py-px text-[10px] font-bold normal-case opacity-80">{labels.expenseOptional}</span>
          </label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={labels.expenseNotePh} />
        </div>
        {err && <p role="alert" className="rounded-xl bg-red-500/10 p-2.5 text-sm font-bold text-red-500">{err}</p>}
        {okMsg && <p className="rounded-xl bg-emerald-500/10 p-2.5 text-sm font-bold text-emerald-600">{okMsg}</p>}
        <Button onClick={() => void submitCreate()} disabled={busy || !typeId || !(Number(amount) > 0)} className="h-12 w-full text-base">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
          {labels.save}
        </Button>
      </div>

      {/* total */}
      <div className="flex items-center justify-between rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-4 py-3">
        <span className="text-sm font-black">{labels.total}</span>
        <span className="text-lg font-black tabular-nums" dir="ltr">{dzMoney(total)}</span>
      </div>

      {/* list */}
      {view.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-(--border-default) p-6 text-center text-sm font-bold opacity-60">
          {labels.empty}
        </p>
      ) : (
        <div className="space-y-2">
          {view.map((r) => (
            <div
              key={r.key}
              className={cn(
                "rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 shadow-sm",
                r.deleteOpId && "opacity-60"
              )}
            >
              <div className="flex items-center gap-2">
                {(() => {
                  const nm = typeName(r.typeId) ?? r.label;
                  const { Icon, tone } = expenseTypeStyle(nm);
                  return (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${tone}22`, color: tone }}>
                      <Icon size={19} />
                    </span>
                  );
                })()}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black" dir="auto">{typeName(r.typeId) ?? r.label}</p>
                  {r.note && <p className="truncate text-xs font-bold opacity-70" dir="auto">{r.note}</p>}
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] font-bold opacity-60">
                    <span className="tabular-nums" dir="ltr">{fmtDay(r.date)}</span>
                    {r.pending && <UnsyncedBadge />}
                  </p>
                </div>
                <span className="shrink-0 text-base font-black tabular-nums" dir="ltr">{dzMoney(r.amount)}</span>
                {r.deleteOpId ? (
                  <button
                    onClick={() => void undoDelete(r)}
                    disabled={busy}
                    className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-(--border-default) px-2.5 text-xs font-black"
                  >
                    <X size={13} /> {labels.no}
                  </button>
                ) : (
                  <>
                    <button
                      aria-label={labels.edit}
                      title={labels.edit}
                      onClick={() => openEdit(r)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken)"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      aria-label={labels.delete}
                      title={labels.delete}
                      onClick={() => { setConfirming(r.key); setEditingKey(null); }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>

              {editingKey === r.key && (
                <div className="mt-3 space-y-2 border-t border-(--border-subtle) pt-3">
                  <ExpenseTypePicker
                    compact
                    types={typeList}
                    value={fTypeId}
                    onChange={setFTypeId}
                    label={labels.expenseTypes}
                    required={!!r.typeId}
                    emptyText={labels.expenseNoTypes}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={fAmount}
                      onChange={(e) => setFAmount(e.target.value)}
                      dir="ltr"
                      inputMode="decimal"
                    />
                    <Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} dir="ltr" />
                  </div>
                  <Input value={fNote} onChange={(e) => setFNote(e.target.value)} maxLength={500} placeholder={`${labels.expenseNote} (${labels.expenseOptional})`} />
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEditingKey(null)} className="flex-1">
                      {labels.cancel}
                    </Button>
                    <Button onClick={() => void submitEdit(r)} disabled={busy} className="flex-[2]">
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                      {labels.save}
                    </Button>
                  </div>
                </div>
              )}

              {confirming === r.key && (
                <div className="mt-3 flex items-center gap-2 border-t border-(--border-subtle) pt-3">
                  <p className="min-w-0 flex-1 text-xs font-bold">{labels.deleteConfirm}</p>
                  <Button variant="secondary" onClick={() => setConfirming(null)} className="h-9 px-3 text-xs">
                    {labels.no}
                  </Button>
                  <Button onClick={() => void submitDelete(r)} disabled={busy} className="h-9 bg-red-500 px-3 text-xs text-white hover:bg-red-600">
                    {labels.yes}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
