"use client";

import { useState } from "react";
import { KeyRound, Settings2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export function AccountSettings({ username, labels, dark = false }: { username: string; labels: Record<string, string>; dark?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextUsername, setNextUsername] = useState(username);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/superadmin/account", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, username: nextUsername, newPassword: newPassword || undefined }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "update_failed");
      setCurrentPassword("");
      setNewPassword("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      const message = (e as Error).message;
      setError(labels[message] ?? message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setNextUsername(username); setError(""); setOpen(true); }}
        className={dark
          ? "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-(--sa-sidebar-muted) transition-colors hover:bg-(--sa-sidebar-hover-bg) hover:text-(--sa-sidebar-hover-fg)"
          : "mt-2 flex items-center gap-1 text-[11px] font-bold hover:opacity-80"}
        style={dark ? undefined : { color: "var(--sa-sidebar-muted)" }}
      >
        <Settings2 className="h-3 w-3" />{labels.accountSettings}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={labels.accountSettings} width="sm">
        <div className="space-y-3">
          <label className="block text-xs font-bold text-(--text-secondary)">{labels.currentPassword} *<Input className="mt-1" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" dir="ltr" /></label>
          <label className="block text-xs font-bold text-(--text-secondary)"><span className="flex items-center gap-1"><UserRound size={13} />{labels.username}</span><Input className="mt-1" value={nextUsername} onChange={(e) => setNextUsername(e.target.value)} autoComplete="username" dir="ltr" /></label>
          <label className="block text-xs font-bold text-(--text-secondary)"><span className="flex items-center gap-1"><KeyRound size={13} />{labels.newPassword}</span><Input className="mt-1" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" dir="ltr" placeholder={labels.passwordOptional} /></label>
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1"><Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">{labels.cancel}</Button><Button onClick={() => void save()} disabled={saving || !currentPassword || !nextUsername.trim()} className="flex-[2]">{saving ? "…" : labels.save}</Button></div>
        </div>
      </Modal>
    </>
  );
}