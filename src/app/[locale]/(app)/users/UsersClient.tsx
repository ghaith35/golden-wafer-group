"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Pencil, Plus, QrCode, RefreshCw, Trash2, Truck, UserRound } from "lucide-react";
import { KpiCard } from "@/components/ui/Card";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";

type User = {
  id: string;
  username: string;
  fullName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  passwordView: string | null;
  qrToken: string | null;
  assignedVans: Array<{ id: string; name: string }>;
};

const ROLES = ["Admin", "Vendeur", "Livreur"] as const;

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

/// QR payload scanned by the login page: {"app":"distribuili","type":"staff-login","u":username,"k":token}
export function staffQrPayload(username: string, token: string) {
  return JSON.stringify({ app: "distribuili", type: "staff-login", u: username, k: token });
}

type FormVal = { fullName: string; username: string; phone: string; password: string; role: string; vanId: string; isActive: boolean };

function UserForm({
  initial,
  roles,
  vans,
  labels,
  saving,
  error,
  isNew,
  onSubmit,
  onClose,
}: {
  initial: FormVal;
  roles: readonly string[];
  vans: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
  saving: boolean;
  error: string | null;
  isNew: boolean;
  onSubmit: (v: FormVal) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = (k: keyof FormVal, val: string | boolean) => setV((p) => ({ ...p, [k]: val }));

  return (
    <div className="grid gap-2">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{labels[error] ?? error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder={labels.fullName} value={v.fullName} onChange={(e) => set("fullName", e.target.value)} />
        <Input
          placeholder={labels.username}
          value={v.username}
          onChange={(e) => set("username", e.target.value)}
          disabled={!isNew}
          dir="ltr"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder={labels.phone}
          value={v.phone}
          onChange={(e) => set("phone", e.target.value)}
          inputMode="tel"
          dir="ltr"
        />
        <Input
          type="text"
          placeholder={labels.password}
          value={v.password}
          onChange={(e) => set("password", e.target.value)}
          dir="ltr"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={v.role} onChange={(e) => set("role", e.target.value)} className={inputCls}>
          {roles.map((r) => (
            <option key={r} value={r}>{roleName(r, labels)}</option>
          ))}
        </select>
        <select value={v.vanId} onChange={(e) => set("vanId", e.target.value)} className={inputCls} aria-label={labels.van} disabled={v.role === "Admin"}>
          <option value="">— {labels.van}</option>
          {vans.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </div>
      {!isNew && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
          {labels.active}
        </label>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {labels.cancel}
        </Button>
        <Button onClick={() => onSubmit(v)} disabled={saving}>
          {saving ? "…" : labels.save}
        </Button>
      </div>
    </div>
  );
}

/// Localized role name (never the raw Admin/Vendeur/Livreur code).
function roleName(role: string, labels: Record<string, string>): string {
  return role === "Admin" ? labels.roleAdmin : role === "Livreur" ? labels.roleLivreur : labels.roleVendeur;
}

/// One staff account card: all details (incl. password) + login QR.
function UserCard({
  u,
  labels,
  allowDelete,
  onEdit,
  onDelete,
  onRegenerate,
}: {
  u: User;
  labels: Record<string, string>;
  allowDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  const [showPw, setShowPw] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setQrUrl(null);
    if (u.qrToken) {
      QRCode.toDataURL(staffQrPayload(u.username, u.qrToken), { margin: 1, width: 220 })
        .then((d) => { if (live) setQrUrl(d); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [u.username, u.qrToken]);

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4 shadow-sm"
      style={u.isActive ? undefined : { opacity: 0.6 }}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-(--bg-sunken) text-(--text-secondary)">
          <UserRound size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black">{u.fullName}</div>
          <div className="truncate font-mono text-xs opacity-60" dir="ltr">@{u.username}</div>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2 py-1 text-[10px] font-black",
          u.role === "Admin" ? "bg-violet-500/15 text-violet-500"
          : u.role === "Livreur" ? "bg-sky-500/15 text-sky-600"
          : "bg-emerald-500/15 text-emerald-600"
        )}>
          {roleName(u.role, labels)}
        </span>
      </div>

      <div className="grid gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide opacity-50">{labels.phone}</span>
          <span className="truncate font-mono text-[13px] font-bold" dir="ltr">{u.phone || "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide opacity-50">{labels.van}</span>
          <span className="flex min-w-0 items-center gap-1 truncate text-[13px] font-bold">
            <Truck size={14} className="shrink-0 opacity-50" />
            <span className="truncate">{u.assignedVans.map((x) => x.name).join(", ") || "—"}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide opacity-50">{labels.password}</span>
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-[13px] font-bold" dir="ltr">
              {u.passwordView ? (showPw ? u.passwordView : "••••••••") : "—"}
            </span>
            {u.passwordView && (
              <button
                type="button"
                onClick={() => setShowPw((x) => !x)}
                aria-label={showPw ? labels.hidePw : labels.showPw}
                title={showPw ? labels.hidePw : labels.showPw}
                className="shrink-0 rounded-lg p-1 opacity-60 hover:bg-(--bg-sunken) hover:opacity-100"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-black",
            u.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", u.isActive ? "bg-emerald-500" : "bg-red-500")} />
            {u.isActive ? labels.active : labels.inactive}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-white p-2.5 text-black">
        {qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrUrl} alt={u.username} className="h-24 w-24 shrink-0 rounded-lg" />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-black/5">
            <QrCode size={28} className="opacity-30" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-wide text-black/50">{labels.qrCode}</div>
          <button
            type="button"
            onClick={onRegenerate}
            className="mt-1.5 flex items-center gap-1 rounded-lg bg-black/5 px-2 py-1 text-[11px] font-black text-black/70 hover:bg-black/10"
          >
            <RefreshCw size={12} />
            {labels.qrRegenerate}
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onEdit} className="flex-1">
          <Pencil size={14} className="me-1" />
          {labels.edit}
        </Button>
        {allowDelete && (
          <Button variant="secondary" onClick={onDelete} className="flex-1 !text-red-500">
            <Trash2 size={14} className="me-1" />
            {labels.delete}
          </Button>
        )}
      </div>
    </div>
  );
}

export function UsersClient({
  locale,
  vans,
  labels,
  allowedRoles = ROLES,
  allowDelete = true,
  scope,
}: {
  locale: string;
  vans: Array<{ id: string; name: string }>;
  labels: Record<string, string>;
  /// Restrict the managed accounts, e.g. the staff page passes
  /// ["Vendeur", "Livreur"] so Admins are only managed in Settings.
  allowedRoles?: readonly string[];
  /// Staff page: create + modify only, no delete.
  allowDelete?: boolean;
  /// Forwarded to the API so role restrictions are enforced server-side.
  scope?: "staff" | "admins";
}) {
  const roles = allowedRoles.length > 0 ? allowedRoles : ROLES;
  const [rows, setRows] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("");
  // Deep-link preset (?new=Livreur|Vendeur): open the create modal with that
  // role preselected. Read the URL in an effect (after mount) so server and
  // client render identically — reading window during init causes hydration
  // mismatch (server: closed, client with ?new=: open).
  const [presetRole, setPresetRole] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("new");
    if (r && (roles as readonly string[]).includes(r)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL → state sync after mount
      setPresetRole(r);
      setCreating(true);
    }
  }, [roles]);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/users");
    if (res.ok) setRows(await res.json());
  }
  useEffect(() => {
    reload().catch(() => {});
  }, []);

  async function regenerate(u: User) {
    const res = await fetch(`/api/users/${u.id}/qr`, { method: "POST" });
    if (!res.ok) {
      setError("qr_failed");
      return;
    }
    const d = await res.json();
    setRows((prev) => prev.map((x) => (x.id === u.id ? { ...x, qrToken: d.qrToken } : x)));
  }

  async function create(v: FormVal) {
    if (!v.username.trim() || !v.fullName.trim() || !v.password) {
      setError("missing_fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: v.username.trim(),
          password: v.password,
          fullName: v.fullName.trim(),
          phone: v.phone.trim() || null,
          role: v.role,
          vanId: v.role === "Admin" ? null : (v.vanId || null),
          ...(scope ? { scope } : {}),
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      setCreating(false);
      setPresetRole(null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function update(v: FormVal) {
    if (!editing || !v.fullName.trim()) {
      setError("missing_fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: v.fullName.trim(),
          phone: v.phone.trim() || null,
          role: v.role,
          isActive: v.isActive,
          vanId: v.role === "Admin" ? null : (v.vanId || null),
          ...(v.password ? { password: v.password } : {}),
          ...(scope ? { scope } : {}),
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
    const res = await fetch(`/api/users/${deleting.id}${scope ? `?scope=${scope}` : ""}`, { method: "DELETE" });
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
        (u) =>
          (roles as readonly string[]).includes(u.role) &&
          (!fRole || u.role === fRole) &&
          (!q || u.fullName.includes(q) || u.username.includes(q) || (u.phone ?? "").includes(q))
      ),
    [rows, q, fRole, roles]
  );

  const emptyForm: FormVal = {
    fullName: "",
    username: "",
    phone: "",
    password: "",
    role: roles.includes("Vendeur") ? "Vendeur" : roles[0] ?? "Vendeur",
    vanId: "",
    isActive: true,
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const u of rows) c[u.role] = (c[u.role] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-4 p-5 md:p-6">
      {error && !creating && !editing && (
        <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{labels[error] ?? error}</p>
      )}

      {/* Role counts + add — the section name lives in the topbar */}
      <div className="grid grid-cols-3 gap-2">
        {roles.map((r) => (
          <KpiCard
            key={r}
            label={roleName(r, labels)}
            value={String(counts[r] ?? 0)}
            icon={<UserRound size={18} />}
            accent={r === "Admin" ? "bg-violet-500/15 text-violet-500" : r === "Livreur" ? "bg-sky-500/15 text-sky-600" : "bg-emerald-500/15 text-emerald-600"}
            compact
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Button
          onClick={() => { setError(null); setCreating(true); }}
          className="shrink-0"
        >
          <Plus size={16} className="me-1" />
          {labels.add}
        </Button>
        <div className="flex-1">
          <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button
            onClick={() => setFRole("")}
            className={cn(
              "min-h-11 shrink-0 rounded-xl px-4 text-xs font-black",
              fRole === "" ? "bg-gradient-brand text-(--brand-contrast) shadow" : "bg-(--bg-sunken) opacity-70"
            )}
          >
            {labels.all ?? "—"}
          </button>
          {roles.map((r) => (
            <button
              key={r}
              onClick={() => setFRole(fRole === r ? "" : r)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 text-xs font-black",
                fRole === r ? "bg-gradient-brand text-(--brand-contrast) shadow" : "bg-(--bg-sunken) opacity-70"
              )}
            >
              {roleName(r, labels)}
              <span className="rounded-full bg-black/15 px-1.5 tabular-nums">{counts[r] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-(--border-default) bg-(--bg-overlay) p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-(--brand-500)/10 text-(--brand-600)">
            <UserRound size={26} />
          </span>
          <p className="text-base font-black">{labels.emptyTitle}</p>
          <p className="max-w-sm text-xs opacity-60">{labels.emptyHintAdmins ?? labels.emptyHint}</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button onClick={() => { setError(null); setCreating(true); }}>
              <Plus size={16} className="me-1" />
              {labels.firstAdd}
            </Button>
            <Link href={labels.goHref} className="inline-flex">
              <Button variant="secondary">{labels.goAdmins}</Button>
            </Link>
          </div>
        </div>
      )}

      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((u) => (
          <UserCard
            key={u.id}
            u={u}
            labels={labels}
            allowDelete={allowDelete}
            onEdit={() => { setError(null); setEditing(u); }}
            onDelete={() => setDeleting(u)}
            onRegenerate={() => regenerate(u)}
          />
        ))}
      </div>

      <Modal
        open={creating}
        onClose={() => { setCreating(false); setPresetRole(null); }}
        title={labels.add}
        subtitle={labels.title}
        icon="+"
      >
        <UserForm
          key={presetRole ?? "new"}
          initial={presetRole ? { ...emptyForm, role: presetRole } : emptyForm}
          roles={roles}
          vans={vans}
          labels={labels}
          saving={saving}
          error={error}
          isNew
          onSubmit={create}
          onClose={() => { setCreating(false); setPresetRole(null); }}
        />
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.fullName ?? ""}
        subtitle={labels.title}
        icon="✎"
      >
        {editing && (
          <UserForm
            key={editing.id}
            initial={{
              fullName: editing.fullName,
              username: editing.username,
              phone: editing.phone ?? "",
              password: "",
              role: editing.role,
              vanId: editing.assignedVans[0]?.id ?? "",
              isActive: editing.isActive,
            }}
            roles={roles}
            vans={vans}
            labels={labels}
            saving={saving}
            error={error}
            isNew={false}
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
        message={deleting ? labels.deleteMessage.replace("{name}", deleting.fullName) : ""}
      />
    </div>
  );
}
