"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

import { ErrText } from "@/components/ui/ErrText";
export function CountValidate({ countId, label }: { countId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function validate() {
    if (!confirm("؟")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/counts/${countId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate" }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-500"><ErrText code={error} /></p>}
      <Button onClick={validate} disabled={busy}>{label}</Button>
    </div>
  );
}
