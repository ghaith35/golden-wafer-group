"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

type Company = {
  id: string;
  name: string;
  phone: string | null;
  createdAt: string;
  _count: { users: number; stores: number };
};

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

/// Vendor companies console: list + provision (company + admin user).
export function CompaniesClient({ labels }: { labels: Record<string, string> }) {
  const [rows, setRows] = useState<Company[]>([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [adminName, setAdminName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/superadmin/companies?q=${encodeURIComponent(q)}`, { cache: "no-store" });
    if (res.ok) setRows(await res.json());
  }, [q]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  async function create() {
    if (!name.trim() || !adminUser.trim() || adminPass.length < 8) {
      setError("missing_fields");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim() || null,
          adminUsername: adminUser.trim(), adminPassword: adminPass, adminName: adminName.trim() || null,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      setCreating(false);
      setName("");
      setPhone("");
      setAdminUser("");
      setAdminPass("");
      setAdminName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button onClick={() => { setError(null); setCreating(true); }} className="shrink-0">+ {labels.neW}</Button>
      </div>
      <div className="grid items-start gap-2 md:grid-cols-2">
        {rows.map((c) => (
          <div key={c.id} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
            <div className="truncate text-sm font-black">{c.name}</div>
            <div className="mt-0.5 text-[11px] opacity-60" dir="ltr">{c.phone ?? ""}</div>
            <div className="mt-1 text-[11px] opacity-70">
              {c._count.users} {labels.users} · {c._count.stores} {labels.stores} · <span className="tabular-nums" dir="ltr">{new Date(c.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
      {rows.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      <Modal open={creating} onClose={() => setCreating(false)} title={labels.newTitle} width="sm">
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.name}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.phone}</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.adminUser}</label>
              <Input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} dir="ltr" autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.adminName}</label>
              <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.adminPass}</label>
            <Input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} dir="ltr" autoComplete="new-password" />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{labels[error] ?? error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)} className="flex-1">{labels.cancel}</Button>
            <Button onClick={() => void create()} disabled={busy} className="flex-[2]">{labels.save}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
