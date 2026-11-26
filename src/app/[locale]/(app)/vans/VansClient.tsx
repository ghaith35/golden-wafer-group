"use client";

import { SwipeRow, SwipeEditDelete } from "@/components/motion/SwipeRow";
import { EmptyState } from "@/components/motion/EmptyState";
import { Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Bus, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/ui/RowActions";
import { KpiCard } from "@/components/ui/Card";
import { VanForm, type VanData } from "./VanForm";
import { useSyncedState } from "@/lib/data-sync";

import { ErrText } from "@/components/ui/ErrText";
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
  const [rows, setRows] = useSyncedState(initial);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VanData | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  /// The driver dropdown only lists active non-Admin staff, but a van may
  /// carry a legacy assignment outside that list (e.g. an Admin). Merge the
  /// edited van's current driver into the options so modify opens with the
  /// assigned driver selected instead of a blank "—".
  const editUsers = useMemo(() => {
    const id = editing?.userId;
    if (!id || users.some((u) => u.id === id)) return users;
    const current = rows.find((r) => r.id === editing?.id)?.user;
    if (!current || current.id !== id) return users;
    return [...users, current];
  }, [users, editing, rows]);

  async function reload() {
    const res = await fetch("/api/locations");
    if (res.ok) {
      const all = (await res.json()) as Row[];
      setRows(all.filter((r) => (r as Row & { kind: string; isActive?: boolean }).kind === "VAN" && (r as Row & { isActive?: boolean }).isActive !== false));
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

  const tu = useTranslations("vans.delUsage");
  type Usage = { stock: number; transfers: number; counts: number; losses: number; returns: number; tournees: number; closes: number; sales: number; expenses: number };
  const [usage, setUsage] = useState<{ van: { id: string; name: string }; data: Usage; stage: 1 | 2 } | null>(null);
  const [wiping, setWiping] = useState(false);

  /// Delete click: look at what the van holds. Clean van → plain confirm;
  /// otherwise list it (1st dialog), then a final warning (2nd dialog).
  async function startDelete(v: { id: string; name: string }) {
    setError(null);
    try {
      const res = await fetch(`/api/locations/${v.id}/usage`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as Usage;
        if (data.stock + data.transfers + data.counts + data.losses + data.returns + data.tournees + data.closes > 0) {
          setUsage({ van: v, data, stage: 1 });
          return;
        }
      }
    } catch {}
    setDeleting(v as never);
  }

  async function wipeEverything() {
    if (!usage) return;
    setWiping(true);
    try {
      const res = await fetch(`/api/locations/${usage.van.id}?force=1`, { method: "DELETE" });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? "delete_failed");
      }
      setUsage(null);
      await reload();
    } finally {
      setWiping(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/locations/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "delete_failed");
      setDeleting(null);
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
    newDriver: labels.newDriver, fullName: labels.fullName, username: labels.username,
    password: labels.password, phone: labels.phone, role: labels.role,
    roleLivreur: labels.roleLivreur, roleVendeur: labels.roleVendeur,
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="grid grid-cols-3 gap-2">
        <KpiCard
          label={labels.title}
          value={String(rows.length)}
          icon={<Bus size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          valueClassName="whitespace-normal! text-clip! break-words leading-tight"
          compact
        />
        <KpiCard
          label={labels.chauffeur}
          value={String(rows.filter((v) => v.user).length)}
          icon={<UserCheck size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          valueClassName="whitespace-normal! text-clip! break-words leading-tight"
          compact
        />
        <KpiCard
          label={labels.noChauffeur}
          value={String(rows.filter((v) => !v.user).length)}
          icon={<UserX size={18} />}
          accent="bg-amber-500/15 text-amber-600"
          valueClassName="whitespace-normal! text-clip! break-words leading-tight"
          compact
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus size={16} className="me-1" />
          {labels.neW}
        </Button>
        <div className="order-last min-w-0 basis-full sm:order-none sm:min-w-40 sm:basis-0 sm:flex-1">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Link
          href={`/${locale}/vans/stock`}
          className="flex shrink-0 items-center rounded-lg bg-(--bg-sunken) px-3 py-2 text-xs font-black hover:bg-(--border-subtle)"
        >
          {labels.stockBoard}
        </Link>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      {filtered.length === 0 && <EmptyState icon={<Inbox size={30} />} title={labels.empty} className="rounded-2xl border border-dashed border-(--border-default)" />}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((v) => (
          <SwipeRow key={v.id} actions={<SwipeEditDelete onEdit={() => openEdit(v)} onDelete={() => void startDelete(v)} editLabel={labels.edit} deleteLabel={labels.delete} />}>
<div
            onClick={() => openEdit(v)}
            className="flex cursor-pointer flex-wrap items-center gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-colors hover:border-(--brand-500)"
            style={v.isActive ? undefined : { opacity: 0.55 }}
          >
            {v.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.imageUrl} alt={v.name} className="h-16 w-16 shrink-0 rounded-xl object-cover sm:w-24" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary) sm:w-24">
                <Bus size={26} />
              </div>
            )}
            <div className="min-w-[8rem] flex-1">
              <div className="truncate text-sm font-bold">{v.name}</div>
              <div className="font-mono text-xs opacity-60" dir="ltr">{v.matricule ?? ""}</div>
              <div className="truncate text-xs opacity-60">
                {v.marque ?? ""}{v.user ? ` · 👨‍✈️ ${v.user.fullName}` : ""}
              </div>
            </div>
            <div className="ms-auto">
            <RowActions
              detailsHref={`/${locale}/vans/${v.id}`}
              onEdit={() => openEdit(v)}
              onDelete={() => void startDelete(v)}
              labels={{ details: labels.details, edit: labels.edit, delete: labels.delete }}
              size="md"
            />
            </div>
          </div>
</SwipeRow>
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
            users={editUsers}
            labels={formLabels}
            onSuccess={() => {
              setEditing(null);
              void reload();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal
        open={usage?.stage === 1}
        onClose={() => setUsage(null)}
        title={tu("usageTitle")}
        width="sm"
        icon="⚠️"
      >
        {usage && (
          <div className="space-y-3 text-sm">
            <p className="font-bold">{tu("usageIntro", { name: usage.van.name })}</p>
            <ul className="space-y-1 rounded-lg bg-(--bg-sunken) p-3">
              {([
                ["stock", "uStock"], ["transfers", "uTransfers"], ["counts", "uCounts"], ["losses", "uLosses"],
                ["returns", "uReturns"], ["tournees", "uTournees"], ["closes", "uCloses"],
              ] as const).filter(([k]) => usage.data[k] > 0).map(([k, label]) => (
                <li key={k} className="flex justify-between gap-3">
                  <span>{tu(label)}</span>
                  <b dir="ltr">{usage.data[k]}</b>
                </li>
              ))}
            </ul>
            {(usage.data.sales > 0 || usage.data.expenses > 0) && (
              <p className="text-xs text-(--text-secondary)">
                {tu("usageKept", { sales: usage.data.sales, expenses: usage.data.expenses })}
              </p>
            )}
            <p className="font-bold">{tu("usageQuestion")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setUsage(null)}>{tu("back")}</Button>
              <Button type="button" onClick={() => setUsage({ ...usage, stage: 2 })}>{tu("yes")}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={usage?.stage === 2}
        onClose={() => setUsage(null)}
        title={tu("warnTitle")}
        width="sm"
        icon="🛑"
      >
        <div className="space-y-4 text-sm">
          <p className="rounded-lg bg-red-500/10 p-3 font-bold text-red-500">{tu("warnBody")}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setUsage(null)}>{tu("back")}</Button>
            <Button type="button" variant="destructive" disabled={wiping} onClick={() => void wipeEverything()}>
              {tu("warnConfirm")}
            </Button>
          </div>
        </div>
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
