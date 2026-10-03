"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Bus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/ui/RowActions";
import { VanForm, type VanData } from "./VanForm";

type Row = {
  id: string;
  name: string;
  marque: string | null;
  matricule: string | null;
  imageUrl: string | null;
  isActive: boolean;
  user: { id: string; fullName: string; username: string } | null;
};

const EMPTY: VanData = { name: "", marque: "", matricule: "", imageUrl: "", userId: "" };

export function VansClient({
  locale,
  initial,
  users,
  labels,
}: {
  locale: string;
  initial: Row[];
  users: Array<{ id: string; fullName: string; username: string }>;
  labels: Record<string, string>;
}) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VanData | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/locations");
    if (res.ok) {
      const all = (await res.json()) as Row[];
      setRows(all.filter((r) => (r as Row & { kind: string }).kind === "VAN"));
    }
  }

  function openEdit(row: Row) {
    setError(null);
    setEditing({
      id: row.id,
      name: row.name,
      marque: row.marque ?? "",
      matricule: row.matricule ?? "",
      imageUrl: row.imageUrl ?? "",
      userId: row.user?.id ?? "",
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/locations/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "delete_failed");
      return;
    }
    setDeleting(null);
    await reload();
  }

  const filtered = rows.filter(
    (v) =>
      !q ||
      v.name.includes(q) ||
      (v.matricule ?? "").includes(q) ||
      (v.marque ?? "").includes(q) ||
      (v.user?.fullName ?? "").includes(q)
  );

  const formLabels = {
    name: labels.name, marque: labels.marque, matricule: labels.matricule,
    chauffeur: labels.chauffeur, noChauffeur: labels.noChauffeur,
    addImage: labels.addImage, removeImage: labels.removeImage,
    save: labels.save, cancel: labels.cancel,
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{labels.title}</h1>
        <Link
          href={`/${locale}/vans/stock`}
          className="shrink-0 rounded-lg bg-(--bg-sunken) px-3 py-2 text-xs font-black hover:bg-(--border-subtle)"
        >
          {labels.stockBoard}
        </Link>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus size={16} className="me-1" />
          {labels.neW}
        </Button>
        <div className="flex-1">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((v) => (
          <div
            key={v.id}
            onClick={() => openEdit(v)}
            className="flex cursor-pointer items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-colors hover:border-(--brand-500)"
            style={v.isActive ? undefined : { opacity: 0.55 }}
          >
            {v.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.imageUrl} alt={v.name} className="h-16 w-24 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
                <Bus size={26} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{v.name}</div>
              <div className="font-mono text-xs opacity-60" dir="ltr">{v.matricule ?? ""}</div>
              <div className="truncate text-xs opacity-60">
                {v.marque ?? ""}{v.user ? ` · 👨‍✈️ ${v.user.fullName}` : ""}
              </div>
            </div>
            <RowActions
              detailsHref={`/${locale}/vans/${v.id}`}
              onEdit={() => openEdit(v)}
              onDelete={() => setDeleting(v)}
              labels={{ details: labels.details, edit: labels.edit, delete: labels.delete }}
              size="md"
            />
          </div>
        ))}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title={labels.neW} subtitle={labels.title} icon="+">
        <VanForm
          key="new"
          initial={EMPTY}
          users={users}
          labels={formLabels}
          onSuccess={() => {
            setCreating(false);
            void reload();
          }}
          onClose={() => setCreating(false)}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.name ?? ""} subtitle={labels.title} icon="✎">
        {editing && (
          <VanForm
            key={editing.id}
            initial={editing}
            users={users}
            labels={formLabels}
            onSuccess={() => {
              setEditing(null);
              void reload();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={labels.deleteTitle}
        message={deleting ? labels.deleteMessage.replace("{name}", deleting.name) : ""}
      />
    </div>
  );
}
