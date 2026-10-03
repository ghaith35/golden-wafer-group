"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BackButton } from "@/components/ui/BackButton";

type Op = { opId: string; kind: string; status: string; error: string | null; createdAt: string };
type Device = {
  id: string;
  label: string;
  isActive: boolean;
  lastSyncAt: string | null;
  location: { id: string; name: string } | null;
  user: { fullName: string } | null;
  ops: Op[];
};

export function DeviceDetail({ deviceId, locale, labels }: { deviceId: string; locale: string; labels: Record<string, string> }) {
  const [d, setD] = useState<Device | null>(null);

  async function reload() {
    setD(await fetch(`/api/devices/${deviceId}`).then((r) => r.json()));
  }
  useEffect(() => {
    reload().catch(() => {});
  }, [deviceId]);

  async function retry(opId: string) {
    await fetch(`/api/devices/${deviceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry-op", opId }),
    });
    await reload();
  }

  async function toggle() {
    if (!d) return;
    await fetch(`/api/devices/${deviceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !d.isActive }),
    });
    await reload();
  }

  if (!d) return <p className="p-6 text-sm opacity-60">…</p>;
  const failed = d.ops.filter((o) => o.status === "FAILED");

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-5 md:p-6">
      <BackButton fallback={`/${locale}/settings/devices`} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{d.label}</h1>
        <Button variant="secondary" onClick={toggle}>{d.isActive ? "⏸" : "▶"}</Button>
      </div>
      <Card>
        <div className="text-sm">🚚 {d.location?.name ?? labels.unbound}</div>
        <div className="text-sm">👤 {d.user?.fullName ?? "—"}</div>
        <div className="text-sm">{labels.lastSync}: {d.lastSyncAt ? new Date(d.lastSyncAt).toLocaleString() : "—"}</div>
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-bold">{labels.failedOps} ({failed.length})</h2>
        {failed.map((o) => (
          <div key={o.opId} className="mb-2 rounded-lg bg-red-500/5 p-2 text-sm">
            <div className="font-bold">{o.kind} <span className="font-mono text-xs opacity-50">{o.opId}</span></div>
            <div className="text-xs text-red-500">{o.error}</div>
            <Button variant="secondary" onClick={() => retry(o.opId)}>{labels.retry}</Button>
          </div>
        ))}
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-bold">Ops ({d.ops.length})</h2>
        {d.ops.slice(0, 30).map((o) => (
          <div key={o.opId} className="flex justify-between py-1 text-xs">
            <span className="font-mono">{o.opId.slice(0, 12)}… · {o.kind}</span>
            <span className={o.status === "APPLIED" ? "text-emerald-600" : "text-red-500"}>{o.status}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
