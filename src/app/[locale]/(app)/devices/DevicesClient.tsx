"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

type Device = {
  id: string;
  label: string;
  isActive: boolean;
  lastSyncAt: string | null;
  location: { id: string; name: string; matricule: string | null } | null;
  user: { id: string; fullName: string } | null;
  _count: { ops: number };
};

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

export function DevicesClient({
  locale,
  vans,
  users,
  labels,
}: {
  locale: string;
  vans: Array<{ id: string; name: string; driverId?: string | null }>;
  users: Array<{ id: string; fullName: string }>;
  labels: Record<string, string>;
}) {
  const [rows, setRows] = useState<Device[]>([]);
  const [q, setQ] = useState("");
  const [fActive, setFActive] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [label, setLabel] = useState("");
  const [van, setVan] = useState("");
  const [user, setUser] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [tokenVan, setTokenVan] = useState("");
  const [tokenLabel, setTokenLabel] = useState("");
  /// Phone-reachable sync URL (admin desktop origin is usually NOT reachable
  /// from the phone — fix the host/port before showing the QR).
  const [setupUrl, setSetupUrl] = useState("");
  const [setupQr, setSetupQr] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/devices");
    if (res.ok) setRows(await res.json());
  }
  useEffect(() => {
    reload().catch(() => {});
  }, []);

  async function create() {
    if (!label.trim()) {
      setError("missing_fields");
      return;
    }
    setSaving(true);
    setError(null);
    setToken(null);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), locationId: van || null, userId: user || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "failed");
        return;
      }
      setToken(data.token as string);
      setTokenVan(van);
      setTokenLabel(label.trim());
      setSetupUrl(`${window.location.origin}/api/sync`);
      setLabel("");
      setVan("");
      setUser("");
      setCreating(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  // Setup QR: token + phone-reachable URL in one scan (shown once).
  useEffect(() => {
    if (!token) {
      setSetupQr("");
      return;
    }
    const payload = JSON.stringify({
      app: "distribuili",
      type: "device-setup",
      url: setupUrl || "/api/sync",
      token,
      van: tokenVan,
      label: tokenLabel,
    });
    QRCode.toDataURL(payload, { margin: 1, width: 320 })
      .then(setSetupQr)
      .catch(() => setSetupQr(""));
  }, [token, setupUrl, tokenVan, tokenLabel]);

  async function saveEdit() {
    if (!editing || !label.trim()) {
      setError("missing_fields");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), locationId: van || null }),
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

  function openEdit(d: Device) {
    setError(null);
    setLabel(d.label);
    setVan(d.location?.id ?? "");
    setEditing(d);
  }

  /// One driver ↔ one van: picking a van fills its driver, picking a
  /// driver fills their van (cleared when the other side has no link).
  function pickVan(id: string) {
    setVan(id);
    setUser(vans.find((v) => v.id === id)?.driverId ?? "");
  }

  function pickUser(id: string) {
    setUser(id);
    setVan(vans.find((v) => v.driverId === id)?.id ?? "");
  }

  const filtered = useMemo(
    () =>
      rows.filter(
        (d) =>
          (!fActive || String(d.isActive) === fActive) &&
          (!q ||
            d.label.includes(q) ||
            (d.location?.name ?? "").includes(q) ||
            (d.user?.fullName ?? "").includes(q))
      ),
    [rows, q, fActive]
  );

  return (
    <div className="space-y-4">
      {error && !creating && !editing && (
        <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>
      )}
      {token && (
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
          <div className="mb-1 text-sm font-bold">{labels.setupQr ?? labels.tokenOnce}</div>
          <p className="mb-2 text-xs font-bold opacity-60">{labels.setupQrHint ?? ""}</p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {setupQr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={setupQr} alt="setup" className="h-52 w-52 rounded-xl bg-white p-2" />
            ) : (
              <div className="flex h-52 w-52 items-center justify-center rounded-xl bg-(--bg-sunken)">…</div>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.syncUrl ?? "url"}</label>
                <Input value={setupUrl} onChange={(e) => setSetupUrl(e.target.value)} dir="ltr" />
              </div>
              <div className="mb-1 text-xs font-bold uppercase opacity-60">{labels.tokenOnce}</div>
              <div className="break-all rounded-lg bg-(--bg-sunken) p-2 font-mono text-xs">{token}</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 lg:flex-1">
          <Button onClick={() => { setError(null); setLabel(""); setVan(""); setUser(""); setCreating(true); }} className="shrink-0">
            <Plus size={16} className="me-1" />
            {labels.newDevice}
          </Button>
          <div className="flex-1">
            <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <select value={fActive} onChange={(e) => setFActive(e.target.value)} className={cn(inputCls, "w-36")}>
            <option value="">—</option>
            <option value="true">{labels.active}</option>
            <option value="false">{labels.inactive}</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 && <p className="rounded-2xl border border-dashed border-(--border-default) p-8 text-center text-sm opacity-60">{labels.empty}</p>}

      <div className="space-y-2">
        {filtered.map((d) => (
          <Link
            key={d.id}
            href={`/${locale}/devices/${d.id}`}
            className="flex items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3 transition-colors hover:border-(--brand-500)"
            style={d.isActive ? undefined : { opacity: 0.55 }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
              <Smartphone size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">
                {d.label} {d.location ? `· 🚚 ${d.location.name}` : `· ${labels.unbound}`}
              </div>
              <div className="truncate text-xs opacity-60">
                {d.user?.fullName ?? ""} · {labels.lastSync}: {d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString() : "—"} · {d._count.ops} ops
              </div>
            </div>
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", d.isActive ? "bg-emerald-500" : "bg-gray-400")} />
            <button
              type="button"
              title={labels.edit}
              aria-label={labels.edit}
              onClick={(e) => { e.preventDefault(); openEdit(d); }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 transition-colors hover:bg-amber-500/25"
            >
              <Pencil size={15} />
            </button>
          </Link>
        ))}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={labels.newDevice}
        subtitle={labels.devices}
        icon="+"
      >
        <div className="grid gap-2">
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <Input placeholder={labels.label} value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <select value={van} onChange={(e) => pickVan(e.target.value)} className={inputCls} aria-label={labels.van}>
              <option value="">— {labels.van}</option>
              {vans.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <select value={user} onChange={(e) => pickUser(e.target.value)} className={inputCls} aria-label={labels.user}>
              <option value="">— {labels.user}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={saving}>
              {labels.cancel}
            </Button>
            <Button onClick={create} disabled={saving}>{saving ? "…" : labels.save}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.label ?? ""}
        subtitle={labels.devices}
        icon="✎"
      >
        <div className="grid gap-2">
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <Input placeholder={labels.label} value={label} onChange={(e) => setLabel(e.target.value)} />
          <select value={van} onChange={(e) => setVan(e.target.value)} className={inputCls} aria-label={labels.van}>
            <option value="">— {labels.van}</option>
            {vans.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              {labels.cancel}
            </Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "…" : labels.save}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
