"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Plus, ReceiptText, Wallet } from "lucide-react";
import { KpiCard } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/ui/RowActions";
import { dz, dzMoney, fmtDT } from "@/lib/format";
import { useDataVersion } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
type Row = {
  id: string;
  label: string;
  description: string | null;
  amount: unknown;
  expenseDate: string;
  typeId: string | null;
  locationId: string | null;
  type: { id?: string; name: string } | null;
  location: { id?: string; name: string } | null;
};

type Option = { id: string; name: string };

const inputCls =
  "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

const fmtAmount = (v: unknown) => dz(v as number);
const fmtTotal = (v: number) => dzMoney(v);

function ExpenseForm({
  initial,
  types,
  locations,
  labels,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  initial: { label: string; amount: string; date: string; typeId: string; locationId: string };
  types: Option[];
  locations: Option[];
  labels: Record<string, string>;
  saving: boolean;
  error: string | null;
  onSubmit: (v: { label: string; amount: string; date: string; typeId: string; locationId: string }) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [amount, setAmount] = useState(initial.amount);
  const [date, setDate] = useState(initial.date);
  const [typeId, setTypeId] = useState(initial.typeId);
  const [locationId, setLocationId] = useState(initial.locationId);

  return (
    <div className="grid gap-2">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <Input placeholder={labels.label} value={label} onChange={(e) => setLabel(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={0}
          step="any"
          placeholder={labels.amount}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={labels.date} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={inputCls} aria-label={labels.type}>
          <option value="">— {labels.type}</option>
          {types.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className={inputCls}
          aria-label={labels.location}
        >
          <option value="">— {labels.location}</option>
          {locations.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </div>
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {labels.cancel}
        </Button>
        <Button
          onClick={() => onSubmit({ label, amount, date, typeId, locationId })}
          disabled={saving}
        >
          {saving ? "…" : labels.save}
        </Button>
      </div>
    </div>
  );
}

export function ExpensesClient({
  types,
  locations,
  labels,
}: {
  types: Option[];
  locations: Option[];
  labels: Record<string, string>;
}) {
  const locale = useLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [fType, setFType] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const sp = new URLSearchParams();
    if (fType) sp.set("typeId", fType);
    if (fLoc) sp.set("locationId", fLoc);
    if (month) {
      const [y, m] = month.split("-");
      sp.set("year", y);
      sp.set("month", String(Number(m)));
    }
    const res = await fetch(`/api/expenses?${sp}`);
    if (res.ok) setRows(await res.json());
  }

  const dataV = useDataVersion();
  useEffect(() => {
    reload().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, fType, fLoc, dataV]);

  function validate(v: { label: string; amount: string }) {
    if (!v.label.trim() || !v.amount || Number(v.amount) <= 0) return "missing_fields";
    return null;
  }

  async function create(v: { label: string; amount: string; date: string; typeId: string; locationId: string }) {
    const err = validate(v);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId: v.typeId || null,
          locationId: v.locationId || null,
          label: v.label.trim(),
          amount: Number(v.amount),
          expenseDate: v.date,
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      setCreating(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function update(v: { label: string; amount: string; date: string; typeId: string; locationId: string }) {
    if (!editing) return;
    const err = validate(v);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/expenses/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId: v.typeId || null,
          locationId: v.locationId || null,
          label: v.label.trim(),
          amount: Number(v.amount),
          expenseDate: v.date,
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      setEditing(null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/expenses/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "delete_failed");
      return;
    }
    setDeleting(null);
    await reload();
  }

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !q ||
          r.label.includes(q) ||
          (r.type?.name ?? "").includes(q) ||
          (r.location?.name ?? "").includes(q)
      ),
    [rows, q]
  );

  const total = useMemo(() => filtered.reduce((s, r) => s + Number(r.amount), 0), [filtered]);

  const monthLabel = useMemo(() => {
    if (!month) return "";
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return month;
    try {
      return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    } catch {
      return month;
    }
  }, [month]);

  const today = () => new Date().toISOString().slice(0, 10);

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 p-5 md:p-6 lg:h-[calc(var(--vh)-3.5rem)] lg:overflow-hidden lg:pb-4">
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <KpiCard
          label={labels.total}
          value={dzMoney(total)}
          icon={<Wallet size={18} />}
          accent="bg-red-500/15 text-red-500"
          compact
        />
        <KpiCard
          label={labels.title}
          value={String(filtered.length)}
          icon={<ReceiptText size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
      </div>
      {error && !creating && !editing && (
        <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>
      )}

      <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 lg:flex-1">
          <Button onClick={() => { setError(null); setCreating(true); }} className="shrink-0">
            <Plus size={16} className="me-1" />
            {labels.new}
          </Button>
          <div className="flex-1">
            <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-44"
            aria-label={monthLabel}
          />
          <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${inputCls} w-36`} aria-label={labels.type}>
            <option value="">— {labels.type}</option>
            {types.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
          <select value={fLoc} onChange={(e) => setFLoc(e.target.value)} className={`${inputCls} w-36`} aria-label={labels.location}>
            <option value="">— {labels.location}</option>
            {locations.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-4 py-3">
        <span className="text-sm font-bold capitalize opacity-80">
          {monthLabel}
          <span className="ms-2 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs font-black opacity-80">
            {filtered.length}
          </span>
        </span>
        <span className="text-base font-black">
          {labels.total}: {fmtTotal(total)}
        </span>
      </div>

      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}

      <div className="min-h-0 space-y-2 lg:flex-1 lg:overflow-y-auto lg:pb-2">
        {filtered.map((r) => (
          <div
            key={r.id}
            onClick={() => { setError(null); setEditing(r); }}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-colors hover:border-(--brand-500)"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
              <ReceiptText size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{r.label}</div>
              <div className="truncate text-xs opacity-60">
                {fmtDT(r.expenseDate, locale)}
                {r.type ? ` · ${r.type.name}` : ""}
                {r.location ? ` · 🚚 ${r.location.name}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-sm font-black">{fmtAmount(r.amount)}</div>
            <RowActions
              onEdit={() => { setError(null); setEditing(r); }}
              onDelete={() => setDeleting(r)}
              labels={{ details: "", edit: labels.edit, delete: labels.delete }}
            />
          </div>
        ))}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={labels.new}
        subtitle={labels.title}
        icon="+"
      >
        <ExpenseForm
          key="new"
          initial={{ label: "", amount: "", date: today(), typeId: fType, locationId: fLoc }}
          types={types}
          locations={locations}
          labels={labels}
          saving={saving}
          error={error}
          onSubmit={create}
          onClose={() => setCreating(false)}
        />
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.label ?? ""}
        subtitle={labels.title}
        icon="✎"
      >
        {editing && (
          <ExpenseForm
            key={editing.id}
            initial={{
              label: editing.label,
              amount: String(editing.amount),
              date: new Date(editing.expenseDate).toISOString().slice(0, 10),
              typeId: editing.typeId ?? (editing.type as { id?: string } | null)?.id ?? "",
              locationId: editing.locationId ?? (editing.location as { id?: string } | null)?.id ?? "",
            }}
            types={types}
            locations={locations}
            labels={labels}
            saving={saving}
            error={error}
            onSubmit={update}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={labels.deleteTitle}
        message={deleting ? labels.deleteMessage.replace("{name}", deleting.label) : ""}
      />
    </div>
  );
}
