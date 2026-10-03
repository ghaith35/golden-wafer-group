"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { ImagePlus, X } from "lucide-react";

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

export type VanData = {
  id?: string;
  name: string;
  marque: string;
  matricule: string;
  imageUrl: string;
  userId: string;
};

export function VanForm({
  initial,
  users,
  labels,
  onSuccess,
  onClose,
}: {
  initial: VanData;
  users: Array<{ id: string; fullName: string; username: string }>;
  labels: Record<string, string>;
  onSuccess?: () => void;
  onClose?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof VanData>(k: K, v: VanData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("file", file);
      data.append("dir", "vans");
      const res = await fetch("/api/uploads", { method: "POST", body: data });
      if (!res.ok) {
        setError("upload_failed");
        return;
      }
      set("imageUrl", (await res.json()).url as string);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!form.name.trim() || !form.marque.trim() || !form.matricule.trim()) {
      setError("fields_required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        kind: "VAN",
        name: form.name.trim(),
        marque: form.marque.trim(),
        matricule: form.matricule.trim(),
        imageUrl: form.imageUrl || null,
        userId: form.userId || null,
      };
      const res = await fetch(form.id ? `/api/locations/${form.id}` : "/api/locations", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "save_failed");
        return;
      }
      onSuccess?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{labels[error] ?? error}</p>}
      <Card>
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            {form.imageUrl ? (
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.imageUrl} alt="" className="h-20 w-28 rounded-xl object-cover" />
                <button
                  type="button"
                  aria-label={labels.removeImage}
                  onClick={() => set("imageUrl", "")}
                  className="absolute end-1 top-1 rounded-full bg-black/55 p-1 text-white hover:bg-black/75"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <label className="flex h-20 w-28 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-(--border-default) text-(--text-secondary) hover:border-(--brand-500)">
                <ImagePlus size={20} />
                <span className="px-1 text-center text-[10px] font-bold leading-tight">{uploading ? "…" : labels.addImage}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
              </label>
            )}
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.name}</label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Camionnette 3" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.marque}</label>
              <Input value={form.marque} onChange={(e) => set("marque", e.target.value)} placeholder="Renault Master" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.matricule}</label>
              <Input value={form.matricule} onChange={(e) => set("matricule", e.target.value)} placeholder="01234-116-16" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.chauffeur}</label>
            <select value={form.userId} onChange={(e) => set("userId", e.target.value)} className={inputCls}>
              <option value="">— {labels.noChauffeur}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName} · {u.username}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>
      <div className="flex gap-2">
        {onClose && (
          <Button variant="secondary" onClick={onClose} className="flex-1">
            {labels.cancel}
          </Button>
        )}
        <Button onClick={submit} disabled={busy || uploading} className="flex-[2]">
          {labels.save}
        </Button>
      </div>
    </div>
  );
}
