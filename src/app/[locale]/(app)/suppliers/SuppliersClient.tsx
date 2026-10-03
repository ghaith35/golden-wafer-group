"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, List, MapPin, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/ui/RowActions";
import { SupplierForm, EMPTY_SUPPLIER, type SupplierData } from "./SupplierForm";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  balance: unknown;
  isActive: boolean;
  wilaya: { code: number; nameAr: string } | null;
  secteur: { name: string } | null;
};

export function SuppliersClient({
  locale,
  initial,
  wilayas,
  secteurs,
  labels,
}: {
  locale: string;
  initial: Row[];
  wilayas: Array<{ code: number; nameAr: string }>;
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  labels: Record<string, string>;
}) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [sec, setSec] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; data: SupplierData } | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/suppliers");
    if (res.ok) setRows(await res.json());
  }

  async function openEdit(row: Row) {
    setError(null);
    const res = await fetch(`/api/suppliers/${row.id}`);
    if (!res.ok) {
      setError("load_failed");
      return;
    }
    const s = await res.json();
    setEditing({
      id: s.id,
      data: {
        name: s.name ?? "",
        phone: s.phone ?? "",
        address: s.address ?? "",
        wilayaCode: s.wilayaCode ? String(s.wilayaCode) : "",
        secteurId: s.secteurId ?? "",
        notes: s.notes ?? "",
      },
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/suppliers/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "delete_failed");
      return;
    }
    setDeleting(null);
    await reload();
  }

  const filtered = rows.filter(
    (s) =>
      (!sec || s.secteur?.name === secteurs.find((x) => x.id === sec)?.name) &&
      (!q || s.name.includes(q) || (s.code ?? "").includes(q) || (s.phone ?? "").includes(q))
  );

  const secCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) {
      if (s.secteur?.name) m.set(s.secteur.name, (m.get(s.secteur.name) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const formLabels = {
    name: labels.name, phone: labels.phone, address: labels.address,
    notes: labels.notes, save: labels.save, cancel: labels.cancel,
    wilaya: labels.wilaya, secteur: labels.secteur,
    secIdentity: labels.secIdentity, secLocation: labels.secLocation,
  };

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{labels.title}</h1>
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus size={16} className="me-1" />
          {labels.neW}
        </Button>
        <div className="flex-1">
          <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex shrink-0 gap-1 rounded-xl bg-(--bg-sunken) p-1">
          <button
            onClick={() => setView("grid")}
            aria-label="grid"
            className={cn("flex h-9 w-9 items-center justify-center rounded-lg", view === "grid" ? "bg-(--bg-overlay) shadow" : "opacity-50")}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setView("list")}
            aria-label="list"
            className={cn("flex h-9 w-9 items-center justify-center rounded-lg", view === "list" ? "bg-(--bg-overlay) shadow" : "opacity-50")}
          >
            <List size={16} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold opacity-60 tabular-nums">
          {filtered.length}
        </span>
      </div>
      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}
      <div className={view === "grid" ? "grid items-start gap-2.5 md:grid-cols-2 xl:grid-cols-3" : "space-y-1.5"}>
        {filtered.map((s) => {
          const bal = Number(s.balance);
          if (view === "list") {
            return (
              <div
                key={s.id}
                onClick={() => void openEdit(s)}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2 transition-colors hover:border-(--brand-500)"
                style={s.isActive ? undefined : { opacity: 0.55 }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-sm font-black text-(--brand-600)">
                  {s.name.trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">
                    {s.name} {s.code && <span className="font-mono text-[11px] opacity-50" dir="ltr">{s.code}</span>}
                  </div>
                  <div className="truncate text-[11px] opacity-60">
                    <bdi dir="ltr">{s.phone}</bdi>
                    {s.wilaya ? <span> · <bdi dir="auto">{s.wilaya.code} {s.wilaya.nameAr}</bdi></span> : ""}
                    {s.secteur?.name ? <span> · <bdi dir="auto">{s.secteur.name}</bdi></span> : ""}
                  </div>
                </div>
                <span className={cn("shrink-0 text-sm font-black tabular-nums", bal > 0 ? "text-amber-600" : "text-emerald-600")} dir="ltr">
                  {dzMoney(bal)}
                </span>
              </div>
            );
          }
          return (
            <div
              key={s.id}
              onClick={() => void openEdit(s)}
              className="cursor-pointer rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5 transition-all hover:-translate-y-px hover:border-(--brand-500)"
              style={s.isActive ? undefined : { opacity: 0.55 }}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-(--brand-500)/10 text-lg font-black text-(--brand-600)">
                  {s.name.trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">{s.name}</div>
                  {s.code && <div className="truncate font-mono text-[11px] opacity-50" dir="ltr">{s.code}</div>}
                </div>
                <span className={cn(
                  "shrink-0 rounded-xl px-2 py-1 text-[13px] font-black tabular-nums",
                  bal > 0 ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"
                )} dir="ltr">
                  {dzMoney(bal)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                {s.phone && (
                  <span className="flex items-center gap-1 rounded-full bg-(--bg-sunken) px-2 py-1 font-bold tabular-nums" dir="ltr">
                    <Phone size={11} className="opacity-60" />
                    {s.phone}
                  </span>
                )}
                {s.wilaya && (
                  <span className="flex items-center gap-1 rounded-full bg-(--bg-sunken) px-2 py-1 font-bold">
                    <MapPin size={11} className="opacity-60" />
                    {s.wilaya.code} · {s.wilaya.nameAr}
                  </span>
                )}
                {s.secteur && (
                  <span className="rounded-full bg-sky-500/10 px-2 py-1 font-black text-sky-600">{s.secteur.name}</span>
                )}
              </div>
              <div className="mt-2 flex justify-end border-t border-(--border-subtle) pt-2" onClick={(e) => e.stopPropagation()}>
                <RowActions
                  detailsHref={`/${locale}/suppliers/${s.id}`}
                  onEdit={() => void openEdit(s)}
                  onDelete={() => setDeleting(s)}
                  labels={{ details: labels.details, edit: labels.edit, delete: labels.delete }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title={labels.neW} subtitle={labels.title} icon="+">
        <SupplierForm
          key="new"
          initial={EMPTY_SUPPLIER}
          wilayas={wilayas}
          secteurs={secteurs}
          labels={formLabels}
          onSuccess={() => {
            setCreating(false);
            void reload();
          }}
          onClose={() => setCreating(false)}
        />
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.data.name ?? ""} subtitle={labels.title} icon="✎">
        {editing && (
          <SupplierForm
            key={editing.id}
            supplierId={editing.id}
            initial={editing.data}
            wilayas={wilayas}
            secteurs={secteurs}
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
