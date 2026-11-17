"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import { ErrText } from "@/components/ui/ErrText";
export type RefRow = { id: string; name: string; symbol?: string | null; isActive: boolean };

export function RefList({
  title,
  rows,
  onAdd,
  onToggle,
  onRename,
  onDelete,
  addLabel,
  nameLabel,
  extra,
}: {
  title: string;
  rows: RefRow[];
  onAdd: (name: string, extra?: Record<string, string>) => Promise<void>;
  onToggle: (row: RefRow) => Promise<void>;
  onRename: (row: RefRow, name: string) => Promise<void>;
  onDelete: (row: RefRow) => Promise<void>;
  addLabel: string;
  nameLabel: string;
  extra?: { key: string; label: string; options: Array<{ value: string; label: string }> };
}) {
  const [name, setName] = useState("");
  const [extraVal, setExtraVal] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function prettyError(e: unknown): string {
    if (e instanceof Error) {
      try {
        const body = JSON.parse(e.message) as { error?: string };
        if (body.error === "stale_session") return "Session expirée — déconnectez-vous puis reconnectez-vous.";
        if (body.error) return body.error;
      } catch { /* plain message */ }
      return e.message;
    }
    return "failed";
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(name.trim(), extra ? { [extra.key]: extraVal } : undefined);
      setName("");
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
      <h2 className="mb-3 text-sm font-bold">{title}</h2>
      {error && <p className="mb-2 rounded-lg bg-red-500/10 p-2 text-sm font-bold text-red-500"><ErrText code={error} /></p>}
      <div className="mb-3 flex gap-2">
        {extra && (
          <select
            value={extraVal}
            onChange={(e) => setExtraVal(e.target.value)}
            className="h-10 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm"
          >
            <option value="">{extra.label}</option>
            {extra.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <Input placeholder={nameLabel} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <Button onClick={submit} disabled={busy || !name.trim() || (extra != null && !extraVal)}>
          {addLabel}
        </Button>
      </div>
      <ul className="divide-y divide-(--border-subtle)">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 py-2">
            {editing === row.id ? (
              <>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onRename(row, editName).then(() => setEditing(null))} />
                <Button variant="secondary" onClick={() => onRename(row, editName).then(() => setEditing(null))}>
                  ✓
                </Button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onToggle(row)} className="flex-1 text-start text-sm font-semibold">
                  {row.name}
                  {!row.isActive && <span className="ms-2 text-xs opacity-50">(✕)</span>}
                </button>
                <Button variant="ghost" onClick={() => { setEditing(row.id); setEditName(row.name); }}>
                  ✎
                </Button>
                <Button variant="ghost" onClick={() => onDelete(row)}>
                  🗑
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
