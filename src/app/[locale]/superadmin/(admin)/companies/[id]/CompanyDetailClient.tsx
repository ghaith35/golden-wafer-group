"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Building2, Pencil, RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { TenantResources } from "./TenantResources";

type TenantUser = { id: string; username: string; fullName: string; phone: string | null; role: string; isActive: boolean; createdAt: string };
type TenantStore = { id: string; name: string; address: string | null; kind: "DEPOT" | "VAN"; marque: string | null; matricule: string | null; isActive: boolean; userId: string | null };
type Company = {
  id: string; name: string; phone: string | null; address: string | null; email: string | null;
  _count: { users: number; stores: number; products: number };
  users: TenantUser[];
  stores: TenantStore[];
};

export function CompanyDetailClient({ id, labels }: { id: string; labels: Record<string, string> }) {
  const locale = useLocale();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", address: "", email: "" });

  const fetchCompany = useCallback(async () => {
    const res = await fetch(`/api/superadmin/companies/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 404 ? "not_found" : "failed");
    return await res.json() as Company;
  }, [id]);

  const load = useCallback(async () => {
    try {
      const row = await fetchCompany();
      setError("");
      setCompany(row);
      setForm({ name: row.name, phone: row.phone ?? "", address: row.address ?? "", email: row.email ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, [fetchCompany]);

  useEffect(() => {
    let cancelled = false;
    fetchCompany().then((row) => {
      if (cancelled) return;
      setCompany(row);
      setForm({ name: row.name, phone: row.phone ?? "", address: row.address ?? "", email: row.email ?? "" });
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "failed");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchCompany]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/superadmin/companies/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed");
      setEditing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/${locale}/superadmin/companies`} aria-label={labels.title} className="flex h-10 w-10 items-center justify-center rounded-lg border border-(--border-default) text-(--text-secondary) hover:bg-(--bg-sunken)">
          <ArrowLeft size={17} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-black text-(--text-primary)">{company?.name ?? labels.title}</h1>
          <p className="text-sm text-(--text-secondary)">{labels.title}</p>
        </div>
        <Button variant="secondary" onClick={() => { setLoading(true); void load(); }} disabled={loading} aria-label={labels.retry}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </Button>
        {company && <Button onClick={() => setEditing(true)}><Pencil size={15} />{labels.edit}</Button>}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm font-semibold text-red-500">{labels[error] ?? error}</p>}
      {loading && !company ? (
        <p className="py-10 text-center text-sm text-(--text-secondary)">{labels.loading}</p>
      ) : !company ? (
        <p className="py-10 text-center text-sm text-(--text-secondary)">{labels.notFound}</p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([[labels.users, company._count.users], [labels.stores, company._count.stores], [labels.products, company._count.products]] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-(--border-default) bg-(--bg-overlay) p-4">
                <p className="text-xs font-bold uppercase text-(--text-secondary)">{label}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-(--text-primary)">{value.toLocaleString()}</p>
              </div>
            ))}
          </section>
          <section className="border-y border-(--border-default) py-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-(--text-primary)"><Building2 size={16} />{company.name}</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([[labels.phone, company.phone], [labels.email, company.email], [labels.address, company.address]] as const).map(([label, value]) => (
                <div key={label} className="min-w-0"><dt className="text-xs text-(--text-secondary)">{label}</dt><dd className="mt-0.5 wrap-break-word text-(--text-primary)" dir="auto">{value || "—"}</dd></div>
              ))}
            </dl>
          </section>
          <TenantResources
            companyId={id}
            users={company.users}
            stores={company.stores}
            onRefresh={load}
            labels={labels}
          />
        </>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title={labels.edit} width="sm">
        <div className="space-y-3">
          {([["name", labels.name], ["phone", labels.phone], ["email", labels.email], ["address", labels.address]] as const).map(([key, label]) => (
            <label key={key} className="block text-xs font-bold text-(--text-secondary)">
              {label}
              <Input className="mt-1" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} dir={key === "phone" || key === "email" ? "ltr" : undefined} />
            </label>
          ))}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditing(false)} className="flex-1">{labels.cancel}</Button>
            <Button onClick={() => void save()} disabled={saving || !form.name.trim()} className="flex-[2]">
              <Save size={15} />{saving ? "…" : labels.save}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}