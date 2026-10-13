"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, MapPin, Phone, Plus, Upload, UserCheck, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/ui/RowActions";
import { KpiCard } from "@/components/ui/Card";
import { ClientForm, type ClientData } from "./ClientForm";
import { ClientImportModal } from "./ClientImportModal";
import { QrPrintModal } from "./qr/print/QrThermalPrint";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  balance: unknown;
  isActive: boolean;
  tier: { name: string } | null;
  secteur: { name: string } | null;
  wilaya: { code: number; nameAr: string } | null;
};

const EMPTY: ClientData = {
  name: "", phone: "", address: "", wilayaCode: "", secteurId: "",
  activityType: "", tierId: "", creditLimit: 0, creditDays: 0, gpsLat: "", gpsLng: "",
};

export function ClientsClient({
  locale,
  initial,
  secteurs,
  wilayas,
  tiers,
  labels,
}: {
  locale: string;
  initial: Row[];
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  wilayas: Array<{ code: number; nameAr: string; nameFr: string }>;
  tiers: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
}) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [sec, setSec] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClientData | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const [importing, setImporting] = useState(false);
  const router = useRouter();
  /// Bulk selection (proforma-style): checkbox per row + header toggle.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function reload() {
    const res = await fetch("/api/clients");
    if (res.ok) setRows(await res.json());
  }

  async function openEdit(row: Row) {
    setError(null);
    const res = await fetch(`/api/clients/${row.id}`);
    if (!res.ok) {
      setError("load_failed");
      return;
    }
    const c = await res.json();
    setEditing({
      id: c.id,
      name: c.name ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      wilayaCode: c.wilayaCode ? String(c.wilayaCode) : "",
      secteurId: c.secteurId ?? "",
      activityType: c.activityType ?? "",
      tierId: c.tierId ?? "",
      creditLimit: Number(c.creditLimit ?? 0),
      creditDays: c.creditDays ?? 0,
      gpsLat: c.gpsLat != null ? String(c.gpsLat) : "",
      gpsLng: c.gpsLng != null ? String(c.gpsLng) : "",
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/clients/${deleting.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "delete_failed");
      return;
    }
    setDeleting(null);
    await reload();
  }

  const filtered = rows.filter(
    (c) =>
      (!sec || c.secteur?.name === secteurs.find((s) => s.id === sec)?.name) &&
      (!q || c.name.includes(q) || c.code.includes(q) || (c.phone ?? "").includes(q))
  );

  const secCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of rows) {
      if (c.secteur?.name) m.set(c.secteur.name, (m.get(c.secteur.name) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s);
      if (allFilteredSelected) for (const c of filtered) n.delete(c.id);
      else for (const c of filtered) n.add(c.id);
      return n;
    });
  }

  const formLabels = {
    name: labels.name, phone: labels.phone, address: labels.address, wilaya: labels.wilaya,
    secteur: labels.secteur, activity: labels.activity, tier: labels.tier,
    creditLimit: labels.creditLimit, creditDays: labels.creditDays,
    secIdentity: labels.secIdentity, secLocation: labels.secLocation, secBilling: labels.secBilling,
    gpsLink: labels.gpsLink, gpsHint: labels.gpsHint, gpsInvalid: labels.gpsInvalid,
    useMyLocation: labels.useMyLocation, gpsDenied: labels.gpsDenied, gps: labels.gps,
    save: labels.save, cancel: labels.cancel,
    portalSecret: labels.portalSecret, secretOnce: labels.secretOnce,
    newSecteur: labels.newSecteur, secteurNamePh: labels.secteurNamePh, selectWilayaFirst: labels.selectWilayaFirst,
    qr: labels.qr,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 p-5 md:p-6 lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden lg:pb-4">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <KpiCard
          label={labels.title}
          value={String(rows.length)}
          icon={<Users size={18} />}
          accent="bg-sky-500/15 text-sky-600"
          compact
        />
        <KpiCard
          label={labels.active}
          value={String(rows.filter((c) => c.isActive).length)}
          icon={<UserCheck size={18} />}
          accent="bg-emerald-500/15 text-emerald-600"
          compact
        />
        <KpiCard
          label={labels.balance}
          value={dzMoney(rows.reduce((s, c) => s + Math.max(0, Number(c.balance ?? 0)), 0))}
          icon={<Wallet size={18} />}
          accent="bg-red-500/15 text-red-500"
          compact
        />
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button onClick={() => setCreating(true)} className="shrink-0" aria-label={labels.neW} title={labels.neW}>
          <Plus size={16} />
        </Button>
        <Button onClick={() => setImporting(true)} variant="secondary" className="shrink-0">
          <Upload size={16} className="me-1" />
          {labels.import}
        </Button>
        <div className="min-w-40 flex-1">
          <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            onClick={() => {
              if (selected.size > 0) setPrintIds([...selected]);
              else router.push(`/${locale}/clients/qr`);
            }}
          >
            {labels.qrPrint}
            {selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
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
      </div>
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      {secteurs.length > 0 && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
          <button
            onClick={() => setSec("")}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-black",
              sec === ""
                ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                : "border-(--border-default) opacity-70 hover:opacity-100"
            )}
          >
            <MapPin size={13} />
            {labels.allS ?? labels.all ?? "—"}
            <span className="rounded-full bg-(--bg-sunken) px-1.5 tabular-nums">{rows.length}</span>
          </button>
          {secteurs.map((s) => {
            const active = sec === s.id;
            const n = secCounts.get(s.name) ?? 0;
            return (
              <button
                key={s.id}
                onClick={() => setSec(active ? "" : s.id)}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-black",
                  active
                    ? "border-(--brand-500) bg-(--brand-500)/10 text-(--brand-600)"
                    : "border-(--border-default) opacity-70 hover:opacity-100"
                )}
              >
                <MapPin size={13} />
                <span className="max-w-28 truncate">{s.name}</span>
                <span className="rounded-full bg-(--bg-sunken) px-1.5 tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}
      {filtered.length > 0 && (
        <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-(--border-default) px-3 py-2 text-sm font-bold">
          <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} />
          <span className="opacity-60">{labels.selectAll}{selected.size > 0 ? ` (${selected.size})` : ""}</span>
        </label>
      )}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-xs font-bold opacity-60 tabular-nums">
          {filtered.length}
        </span>
      </div>
      <div className={cn(view === "grid" ? "grid min-h-0 items-start gap-2.5 md:grid-cols-2 lg:flex-1 lg:overflow-y-auto xl:grid-cols-3" : "min-h-0 space-y-1.5 lg:flex-1 lg:overflow-y-auto lg:pb-2")}>
        {filtered.map((c) => {
          const bal = Number(c.balance);
          if (view === "list") {
            return (
              <div
                key={c.id}
                onClick={() => void openEdit(c)}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2 transition-colors hover:border-(--brand-500)"
                style={c.isActive ? undefined : { opacity: 0.55 }}
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  checked={selected.has(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(c.id)}
                  aria-label={c.name}
                />
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-sm font-black text-(--brand-600)">
                  {c.name.trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">
                    {c.name} <span className="font-mono text-[11px] opacity-50" dir="ltr">{c.code}</span>
                  </div>
                  <div className="truncate text-[11px] opacity-60">
                    <bdi dir="ltr">{c.phone}</bdi>
                    {c.wilaya ? <span> · <bdi dir="auto">{c.wilaya.code} {c.wilaya.nameAr}</bdi></span> : ""}
                    {c.secteur?.name ? <span> · <bdi dir="auto">{c.secteur.name}</bdi></span> : ""}
                  </div>
                </div>
                <span className={cn("shrink-0 text-sm font-black tabular-nums", bal > 0 ? "text-red-500" : "text-emerald-600")} dir="ltr">
                  {dzMoney(bal)}
                </span>
              </div>
            );
          }
          return (
            <div
              key={c.id}
              onClick={() => void openEdit(c)}
              className="cursor-pointer rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3.5 transition-colors hover:border-(--brand-500)"
              style={c.isActive ? undefined : { opacity: 0.55 }}
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  checked={selected.has(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(c.id)}
                  aria-label={c.name}
                />
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-(--brand-500)/10 text-lg font-black text-(--brand-600)">
                  {c.name.trim().charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">{c.name}</div>
                  <div className="truncate font-mono text-[11px] opacity-50" dir="ltr">{c.code}</div>
                </div>
                <span className={cn(
                  "shrink-0 rounded-xl px-2 py-1 text-[13px] font-black tabular-nums",
                  bal > 0 ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-600"
                )} dir="ltr">
                  {dzMoney(bal)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                {c.phone && (
                  <span className="flex items-center gap-1 rounded-full bg-(--bg-sunken) px-2 py-1 font-bold tabular-nums" dir="ltr">
                    <Phone size={11} className="opacity-60" />
                    {c.phone}
                  </span>
                )}
                {c.wilaya && (
                  <span className="flex items-center gap-1 rounded-full bg-(--bg-sunken) px-2 py-1 font-bold">
                    <MapPin size={11} className="opacity-60" />
                    {c.wilaya.code} · {c.wilaya.nameAr}
                  </span>
                )}
                {c.secteur && (
                  <span className="rounded-full bg-sky-500/10 px-2 py-1 font-black text-sky-600">{c.secteur.name}</span>
                )}
                {c.tier && (
                  <span className="rounded-full bg-violet-500/10 px-2 py-1 font-black text-violet-500">{c.tier.name}</span>
                )}
              </div>
              <div className="mt-2 flex justify-end border-t border-(--border-subtle) pt-2" onClick={(e) => e.stopPropagation()}>
                <RowActions
                  detailsHref={`/${locale}/clients/${c.id}`}
                  onEdit={() => void openEdit(c)}
                  onDelete={() => setDeleting(c)}
                  labels={{ details: labels.details, edit: labels.edit, delete: labels.delete }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={labels.neW}
        subtitle={labels.title}
        icon="+"
        width="lg"
      >
        <ClientForm
          key="new"
          locale={locale}
          initial={EMPTY}
          wilayas={wilayas}
          secteurs={secteurs}
          tiers={tiers}
          labels={formLabels}
          onSuccess={() => {
            setCreating(false);
            void reload();
          }}
          onClose={() => setCreating(false)}
        />
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.name ?? ""}
        subtitle={labels.title}
        icon="✎"
        width="lg"
      >
        {editing && (
          <ClientForm
            key={editing.id}
            locale={locale}
            initial={editing}
            wilayas={wilayas}
            secteurs={secteurs}
            tiers={tiers}
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

      <Modal
        open={printIds !== null}
        onClose={() => setPrintIds(null)}
        title={`${labels.qrPrint}${printIds?.length ? ` (${printIds.length})` : ""}`}
        icon="🖨️"
        width="lg"
      >
        {printIds && (
          <QrPrintModal
            key={printIds.join(",")}
            ids={printIds}
            ui={{
              title: labels.qrPrint,
              print: labels.print,
              pdf: labels.pdf,
              downloadFile: labels.downloadFile,
              generating: labels.generating,
            }}
          />
        )}
      </Modal>

      <ClientImportModal
        open={importing}
        onClose={() => setImporting(false)}
        onDone={() => void reload()}
        labels={labels}
      />
    </div>
  );
}
