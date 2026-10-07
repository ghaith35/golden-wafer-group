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

/// Vendor companies console (repaire-style table): search + count + New,
/// rows with name/phone, users, stores, created date.
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
          name: name.trim(),
          phone: phone.trim() || null,
          adminUsername: adminUser.trim(),
          adminPassword: adminPass,
          adminName: adminName.trim() || null,
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-(--text-primary)">{labels.title}</h1>
          <p className="text-sm text-(--text-secondary)">
            {labels.countLine
              .replace("{filtered}", String(rows.length))
              .replace("{total}", String(rows.length))}
          </p>
        </div>
        <Button onClick={() => { setError(null); setCreating(true); }} className="shrink-0">
          + {labels.neW}
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="max-w-xs flex-1">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-(--border-default) bg-(--bg-overlay) shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-(--border-default) bg-(--bg-sunken)">
              <th className="px-4 py-3 text-start font-medium text-(--text-secondary)">{labels.colName}</th>
              <th className="px-4 py-3 text-center font-medium text-(--text-secondary)">{labels.colUsers}</th>
              <th className="px-4 py-3 text-center font-medium text-(--text-secondary)">{labels.colStores}</th>
              <th className="px-4 py-3 text-start font-medium text-(--text-secondary)">{labels.colCreated}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border-default)">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-(--text-secondary)">
                  {labels.empty}
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-(--bg-sunken)/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-(--text-primary)">{c.name}</div>
                    {c.phone && (
                      <p className="text-xs text-(--text-secondary)" dir="ltr">
                        {c.phone}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-(--text-primary) tabular-nums">{c._count.users}</td>
                  <td className="px-4 py-3 text-center text-(--text-primary) tabular-nums">{c._count.stores}</td>
                  <td className="px-4 py-3 text-xs text-(--text-secondary)" dir="ltr">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
            <Button variant="secondary" onClick={() => setCreating(false)} className="flex-1">
              {labels.cancel}
            </Button>
            <Button onClick={() => void create()} disabled={busy} className="flex-[2]">
              {labels.save}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
