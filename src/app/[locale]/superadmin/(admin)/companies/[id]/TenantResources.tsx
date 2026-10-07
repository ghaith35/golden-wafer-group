"use client";

import { useState } from "react";
import { Pencil, Plus, UserRound, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

type TenantUser = { id: string; username: string; fullName: string; phone: string | null; role: string; isActive: boolean };
type TenantStore = { id: string; name: string; address: string | null; kind: "DEPOT" | "VAN"; marque: string | null; matricule: string | null; isActive: boolean; userId: string | null };

export function TenantResources({ companyId, users, stores, onRefresh, labels }: {
  companyId: string;
  users: TenantUser[];
  stores: TenantStore[];
  onRefresh: () => Promise<void>;
  labels: Record<string, string>;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const [userEdit, setUserEdit] = useState<TenantUser | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);
  const [storeEdit, setStoreEdit] = useState<TenantStore | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [userForm, setUserForm] = useState({ username: "", fullName: "", phone: "", password: "", role: "Vendeur" });
  const [storeForm, setStoreForm] = useState({ name: "", address: "", kind: "DEPOT" as "DEPOT" | "VAN", marque: "", matricule: "" });

  async function send(url: string, method: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed");
      await onRefresh();
      return true;
    } catch (e) {
      setError(labels[(e as Error).message] ?? (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openUser(user?: TenantUser) {
    setError("");
    setUserEdit(user ?? null);
    setUserForm({ username: user?.username ?? "", fullName: user?.fullName ?? "", phone: user?.phone ?? "", password: "", role: user?.role ?? "Vendeur" });
    setUserOpen(true);
  }

  async function saveUser() {
    const url = userEdit
      ? `/api/superadmin/companies/${companyId}/users/${userEdit.id}`
      : `/api/superadmin/companies/${companyId}/users`;
    const body: Record<string, unknown> = { username: userForm.username, fullName: userForm.fullName, phone: userForm.phone, role: userForm.role };
    if (userForm.password) body.password = userForm.password;
    if (!userEdit) body.password = userForm.password;
    if (await send(url, userEdit ? "PATCH" : "POST", body)) setUserOpen(false);
  }

  function openStore(store?: TenantStore) {
    setError("");
    setStoreEdit(store ?? null);
    setStoreForm({ name: store?.name ?? "", address: store?.address ?? "", kind: store?.kind ?? "DEPOT", marque: store?.marque ?? "", matricule: store?.matricule ?? "" });
    setStoreOpen(true);
  }

  async function saveStore() {
    const url = storeEdit
      ? `/api/superadmin/companies/${companyId}/stores/${storeEdit.id}`
      : `/api/superadmin/companies/${companyId}/stores`;
    if (await send(url, storeEdit ? "PATCH" : "POST", storeForm)) setStoreOpen(false);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section>
        <div className="flex items-center justify-between border-b border-(--border-default) pb-3">
          <h2 className="flex items-center gap-2 text-sm font-black text-(--text-primary)"><UserRound size={16} />{labels.staff} <span className="font-mono opacity-60">{users.length}</span></h2>
          <Button onClick={() => openUser()}><Plus size={15} />{labels.addUser}</Button>
        </div>
        <div className="divide-y divide-(--border-default)">
          {users.map((user) => (
            <div key={user.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-(--text-primary)">{user.fullName}</p>
                <p className="truncate text-xs text-(--text-secondary)" dir="ltr">{user.username}{user.phone ? ` · ${user.phone}` : ""} · {user.role}</p>
              </div>
              <Button variant="secondary" onClick={() => void send(`/api/superadmin/companies/${companyId}/users/${user.id}`, "PATCH", { isActive: !user.isActive })} disabled={busy} className="px-3 text-xs">
                {user.isActive ? labels.disable : labels.enable}
              </Button>
              <Button variant="ghost" onClick={() => openUser(user)} disabled={busy} aria-label={labels.edit}><Pencil size={15} /></Button>
            </div>
          ))}
          {users.length === 0 && <p className="py-5 text-sm text-(--text-secondary)">{labels.noStaff}</p>}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between border-b border-(--border-default) pb-3">
          <h2 className="flex items-center gap-2 text-sm font-black text-(--text-primary)"><Warehouse size={16} />{labels.locations} <span className="font-mono opacity-60">{stores.length}</span></h2>
          <Button onClick={() => openStore()}><Plus size={15} />{labels.addLocation}</Button>
        </div>
        <div className="divide-y divide-(--border-default)">
          {stores.map((store) => (
            <div key={store.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-(--text-primary)">{store.name}</p>
                <p className="truncate text-xs text-(--text-secondary)">{store.kind === "VAN" ? labels.van : labels.depot}{store.matricule ? ` · ${store.matricule}` : ""}{store.address ? ` · ${store.address}` : ""}</p>
              </div>
              <Button variant="secondary" onClick={() => void send(`/api/superadmin/companies/${companyId}/stores/${store.id}`, "PATCH", { isActive: !store.isActive })} disabled={busy} className="px-3 text-xs">
                {store.isActive ? labels.disable : labels.enable}
              </Button>
              <Button variant="ghost" onClick={() => openStore(store)} disabled={busy} aria-label={labels.edit}><Pencil size={15} /></Button>
            </div>
          ))}
          {stores.length === 0 && <p className="py-5 text-sm text-(--text-secondary)">{labels.noLocations}</p>}
        </div>
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm font-semibold text-red-500 xl:col-span-2">{error}</p>}

      <Modal open={userOpen} onClose={() => setUserOpen(false)} title={userEdit ? labels.editUser : labels.addUser} width="sm">
        <div className="space-y-3">
          <Field label={labels.username}><Input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} dir="ltr" autoComplete="off" /></Field>
          <Field label={labels.fullName}><Input value={userForm.fullName} onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })} /></Field>
          <Field label={labels.phone}><Input value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={userEdit ? labels.newPasswordOptional : labels.password}><Input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} dir="ltr" autoComplete="new-password" /></Field>
          <Field label={labels.role}><select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm"><option value="Admin">Admin</option><option value="Vendeur">Vendeur</option><option value="Livreur">Livreur</option></select></Field>
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1"><Button variant="secondary" onClick={() => setUserOpen(false)} className="flex-1">{labels.cancel}</Button><Button onClick={() => void saveUser()} disabled={busy || !userForm.username.trim() || !userForm.fullName.trim() || (!userEdit && userForm.password.length < 8)} className="flex-2">{busy ? "…" : labels.save}</Button></div>
        </div>
      </Modal>

      <Modal open={storeOpen} onClose={() => setStoreOpen(false)} title={storeEdit ? labels.editLocation : labels.addLocation} width="sm">
        <div className="space-y-3">
          <Field label={labels.name}><Input value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} /></Field>
          {!storeEdit && <Field label={labels.kind}><select value={storeForm.kind} onChange={(e) => setStoreForm({ ...storeForm, kind: e.target.value as "DEPOT" | "VAN" })} className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm"><option value="DEPOT">{labels.depot}</option><option value="VAN">{labels.van}</option></select></Field>}
          {storeForm.kind === "VAN" && <><Field label={labels.brand}><Input value={storeForm.marque} onChange={(e) => setStoreForm({ ...storeForm, marque: e.target.value })} /></Field><Field label={labels.registration}><Input value={storeForm.matricule} onChange={(e) => setStoreForm({ ...storeForm, matricule: e.target.value })} dir="ltr" /></Field></>}
          <Field label={labels.address}><Input value={storeForm.address} onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} /></Field>
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1"><Button variant="secondary" onClick={() => setStoreOpen(false)} className="flex-1">{labels.cancel}</Button><Button onClick={() => void saveStore()} disabled={busy || !storeForm.name.trim()} className="flex-2">{busy ? "…" : labels.save}</Button></div>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-bold text-(--text-secondary)">{label}<div className="mt-1">{children}</div></label>;
}