"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type Dep = {
  id: string;
  client: string;
  version: string;
  domain: string;
  domainOverride: string | null;
  overrideActive: boolean;
  machineId: string | null;
  tunnelSlotId: string | null;
  tunnelSlot: { id: string; subdomain: string; domain: string; status: string } | null;
  status: string;
  lastError: string | null;
  notes: string | null;
  createdAt: string;
};

/// Vendor client deployments: each sold version with its subdomain (+ the
/// tunnel/APK side paired to it). Create enqueues a `pending` row for the
/// provision worker; primary domains are vendor-only (no edit, no delete).
export function DeploymentsClient({ labels }: { labels: Record<string, string> }) {
  const [rows, setRows] = useState<Dep[]>([]);
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const d = await fetch("/api/superadmin/deployments", { cache: "no-store" }).then((r) => r.json());
    setRows(d.rows ?? []);
  }
  useEffect(() => {
    reload().catch(() => {});
  }, []);

  async function act(id: string, action: string, extra?: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/deployments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(extra ?? {}) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: client.trim().toLowerCase() }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      setClient("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const pill = (s: string) =>
    s === "active" ? "bg-emerald-500/10 text-emerald-600"
    : s === "failed" ? "bg-red-500/10 text-red-500"
    : s === "deactivated" ? "bg-gray-500/10 text-gray-500"
    : "bg-amber-500/10 text-amber-600";

  const serving = (r: Dep) => (r.overrideActive && r.domainOverride ? r.domainOverride : r.domain);

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      <Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder={labels.depClient} className="flex-1" dir="ltr" />
          <Button onClick={() => void create()} disabled={busy || !client.trim()} className="shrink-0">
            {busy ? "…" : labels.depCreate}
          </Button>
        </div>
      </Card>
      {rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-(--border-default) p-6 text-center">
          <p className="text-sm font-black">{labels.depEmpty}</p>
          <p className="mx-auto mt-1 max-w-md text-xs opacity-60">{labels.depHow1}</p>
        </div>
      )}
      <div className="space-y-2">
      {rows.length > 0 && rows.map((r) => (
          <Card key={r.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm font-black" dir="ltr">{r.client}</div>
                <div className="truncate font-mono text-[11px] opacity-60" dir="ltr">
                  → {serving(r)}
                  {r.overrideActive && r.domainOverride ? ` (${labels.depOverride})` : ""}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] opacity-40" dir="ltr">
                  {labels.depPrimary}: {r.domain}
                </div>
                {r.machineId && (
                  <div className="mt-0.5 truncate font-mono text-[11px] opacity-60" dir="ltr">PC: {r.machineId.slice(0, 8)}…</div>
                )}
                {r.tunnelSlot && (
                  <div className="mt-0.5 truncate font-mono text-[11px] opacity-60" dir="ltr">
                    tunnel: {r.tunnelSlot.domain} ({r.tunnelSlot.status})
                  </div>
                )}
                {r.lastError && <div className="mt-0.5 truncate text-[11px] font-bold text-red-500">{r.lastError}</div>}
              </div>
              <span className={cn("shrink-0 rounded-lg px-2 py-1 text-[11px] font-black", pill(r.status))}>
                {r.status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(r.status === "pending" || r.status === "failed") && (
                <Button variant="secondary" onClick={() => void act(r.id, "retry")} disabled={busy} className="min-h-9 text-xs">
                  {labels.depRetry}
                </Button>
              )}
              {r.status === "deactivated" ? (
                <Button variant="secondary" onClick={() => void act(r.id, "activate")} disabled={busy} className="min-h-9 text-xs">
                  {labels.depActivate}
                </Button>
              ) : (
                r.status === "active" && (
                  <Button variant="secondary" onClick={() => void act(r.id, "deactivate")} disabled={busy} className="min-h-9 text-xs">
                    {labels.depDeactivate}
                  </Button>
                )
              )}
              {r.overrideActive ? (
                <Button variant="secondary" onClick={() => void act(r.id, "toggle_override")} disabled={busy} className="min-h-9 text-xs">
                  {labels.depUsePrimary}
                </Button>
              ) : (
                r.domainOverride && (
                  <Button variant="secondary" onClick={() => void act(r.id, "toggle_override")} disabled={busy} className="min-h-9 text-xs">
                    {labels.depUseOverride}
                  </Button>
                )
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
