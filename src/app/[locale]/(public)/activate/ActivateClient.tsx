"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

type Status = {
  activated: boolean;
  inTrial: boolean;
  expired: boolean;
  daysLeft: number;
  trialEnd: string | null;
  activationKey: string | null;
  machineId: string;
  devBypass?: boolean;
  serverUrl?: string;
  error?: string;
  revoked?: boolean;
  locked?: boolean;
};

export function ActivateClient({ labels }: { labels: Record<string, string> }) {
  const isDesktop = typeof window !== "undefined" && !!window.distribuili?.isDesktop;
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!window.distribuili) return;
    setStatus((await window.distribuili.licenseStatus()) as Status);
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const s = (await fn()) as Status;
      setStatus(s);
      if (s.error) setMsg(s.error);
    } finally {
      setBusy(false);
    }
  }

  if (!isDesktop) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Card><p className="text-sm">{labels.webNote}</p></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-brand text-xl font-black text-white">D</div>
        <h1 className="text-xl font-bold">{labels.title}</h1>
      </div>

      {status && (
        <Card>
          <div className="text-sm"><b>{labels.machine}:</b> <span className="font-mono text-xs">{status.machineId}</span></div>
          {status.devBypass && <div className="text-xs text-amber-600">DEV — placeholder key</div>}
          {status.activated && <div className="font-bold text-emerald-600">✓ {labels.activated}</div>}
          {status.inTrial && <div className="font-bold text-amber-600">{labels.trial}: {status.daysLeft}j</div>}
          {status.expired && <div className="font-bold text-red-500">{labels.expired}</div>}
          {(status.locked || status.revoked) && (
            <div className="mt-1 rounded-lg bg-red-500/10 p-2 text-sm font-bold text-red-500">
              🔒 {labels.locked}: {labels.revoked}
            </div>
          )}
        </Card>
      )}

      {msg && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{msg}</p>}

      <Card>
        <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.shopLabel}</label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Mon dépôt" />
        <div className="mt-2 flex gap-2">
          <Button disabled={busy} onClick={() => run(() => window.distribuili!.licenseStartTrial({ label }))}>
            {labels.trialBtn}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => run(() => window.distribuili!.licenseCheck())}>
            {labels.check}
          </Button>
        </div>
      </Card>

      <Card>
        <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.key}</label>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" dir="ltr" />
        <div className="mt-2 flex gap-2">
          <Button disabled={busy || !key.trim()} onClick={() => run(() => window.distribuili!.licenseRedeemKey(key.trim(), label))}>
            {labels.redeem}
          </Button>
        </div>
      </Card>
    </div>
  );
}
