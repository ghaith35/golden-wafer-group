"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type Slot = {
  id: string; subdomain: string; domain: string; label: string | null;
  status: string; tunnelId: string | null; token: string | null;
  createdAt: string;
};

/// Vendor tunnel slots: allocate clientN hostnames, revoke them.
/// Active = Cloudflare provisioned; manual = create tunnel + CNAME by hand;
/// revoked = DNS/tunnel removed (client LAN/offline unaffected).
export function TunnelsClient({ labels }: { labels: Record<string, string> }) {
  const [rows, setRows] = useState<Slot[]>([]);
  const [cf, setCf] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  async function reload() {
    const d = await fetch("/api/superadmin/tunnels", { cache: "no-store" }).then((r) => r.json());
    setRows(d.rows ?? []);
    setCf(!!d.cfConfigured);
  }
  useEffect(() => {
    reload().catch(() => {});
  }, []);

  async function allocate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/tunnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      setLabel("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/superadmin/tunnels/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const pill = (s: string) =>
    s === "active" ? "bg-emerald-500/10 text-emerald-600"
    : s === "revoked" ? "bg-red-500/10 text-red-500"
    : "bg-amber-500/10 text-amber-600";

  return (
    <div className="space-y-4">
      {!cf && (
        <p className="rounded-xl bg-amber-500/10 p-3 text-xs font-bold text-amber-600">
          {labels.tunnelManual}
        </p>
      )}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      <Card>
        <div className="flex gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={labels.tunnelLabel} className="flex-1" />
          <Button onClick={() => void allocate()} disabled={busy} className="shrink-0">
            {busy ? "…" : labels.tunnelAllocate}
          </Button>
        </div>
      </Card>
      {rows.length === 0 && <p className="text-sm opacity-60">{labels.tunnelEmpty}</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm font-black" dir="ltr">{r.domain}</div>
                {r.label && <div className="truncate text-xs opacity-60">{r.label}</div>}
              </div>
              <span className={cn("shrink-0 rounded-lg px-2 py-1 text-[11px] font-black", pill(r.status))}>
                {r.status}
              </span>
            </div>
            {r.token && (
              <div className="mt-2">
                <div className="mb-1 text-[11px] font-bold uppercase opacity-60">{labels.tunnelToken}</div>
                <div className="break-all rounded-lg bg-(--bg-sunken) p-2 font-mono text-[11px]" dir="ltr">
                  {shown === r.id ? r.token : "•".repeat(24)}
                </div>
                <button
                  type="button"
                  onClick={() => setShown(shown === r.id ? null : r.id)}
                  className="mt-1 text-[11px] font-bold opacity-60 underline"
                >
                  {shown === r.id ? labels.tunnelHide : labels.tunnelShow}
                </button>
              </div>
            )}
            {r.status !== "revoked" && (
              <div className="mt-2 flex justify-end">
                <Button variant="secondary" onClick={() => void revoke(r.id)} disabled={busy} className="h-9 px-3 text-xs">
                  {labels.tunnelRevoke}
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
