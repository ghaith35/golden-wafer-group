"use client";

import { useState } from "react";
import { MapPin, Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

import { ErrText } from "@/components/ui/ErrText";
const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none";

export type SupplierData = Record<string, string>;

export const EMPTY_SUPPLIER: SupplierData = {
  name: "", phone: "", address: "", wilayaCode: "", secteurId: "", notes: "",
};

/// Shared create/edit form. Without supplierId it POSTs, otherwise PATCHes.
export function SupplierForm({
  supplierId,
  initial,
  wilayas,
  secteurs,
  labels,
  onSuccess,
  onClose,
}: {
  supplierId?: string;
  initial: SupplierData;
  wilayas: Array<{ code: number; nameAr: string }>;
  secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
  labels: Record<string, string>;
  onSuccess?: () => void;
  onClose?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!form.name.trim()) {
      setError("name_required");
      return;
    }
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        wilayaCode: form.wilayaCode ? Number(form.wilayaCode) : null,
        secteurId: form.secteurId || null,
      };
      const res = await fetch(supplierId ? `/api/suppliers/${supplierId}` : "/api/suppliers", {
        method: supplierId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "save_failed");
        return;
      }
      if (onSuccess) {
        onSuccess();
      } else {
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)">
            <Store size={16} />
          </span>
          <span className="text-sm font-black">{labels.secIdentity}</span>
        </div>
        <div className="grid gap-3">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={labels.name} />
          <div className="grid grid-cols-2 gap-3">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder={labels.phone} inputMode="tel" dir="ltr" />
            <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder={labels.address} />
          </div>
        </div>
      </Card>
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
            <MapPin size={16} />
          </span>
          <span className="text-sm font-black">{labels.secLocation}</span>
        </div>
        <div className="grid gap-3">
          <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder={labels.address} />
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={labels.notes} />
        </div>
      </Card>
      <div className="flex gap-2">
        {onClose && (
          <Button variant="secondary" onClick={onClose} className="flex-1">
            {labels.cancel}
          </Button>
        )}
        <Button onClick={submit} disabled={busy} className="flex-[2]">
          {labels.save} {saved ? "✓" : ""}
        </Button>
      </div>
    </div>
  );
}
