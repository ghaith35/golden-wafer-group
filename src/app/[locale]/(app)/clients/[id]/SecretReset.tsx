"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function SecretReset({ clientId, labels }: { clientId: string; labels: Record<string, string> }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (!confirm("؟")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-secret`, { method: "POST" });
      if (res.ok) setSecret((await res.json()).portalSecret as string);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-2 text-sm font-bold">{labels.portalSecret}</div>
      {secret ? (
        <>
          <div className="my-1 text-center text-3xl font-black tracking-widest">{secret}</div>
          <div className="text-center text-xs opacity-60">{labels.secretOnce}</div>
        </>
      ) : (
        <Button variant="secondary" onClick={reset} disabled={busy}>
          {labels.resetSecret}
        </Button>
      )}
    </Card>
  );
}
