"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, KeyRound, MonitorSmartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Key = { id: string; label: string | null; machineId: string | null; humanKey: string; revoked: boolean; createdAt: string };
type Machine = { machineId: string; label: string | null; phone: string | null; lastSeen: string };

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

export function LicenseConsole({ labels }: { labels: Record<string, string> }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [configured, setConfigured] = useState(true);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Key | null>(null);
  const [deleting, setDeleting] = useState<Key | null>(null);
  const [label, setLabel] = useState("");
  const [machineId, setMachineId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const d = await fetch("/api/license/keys").then((r) => r.json());
    setKeys(d.keys ?? []);
    setMachines(d.machines ?? []);
    setConfigured(d.licenseConfigured !== false);
  }
  useEffect(() => {
    reload().catch(() => {});
  }, []);

  async function mint() {
    setSaving(true);
    setError(null);
    try {
      await fetch("/api/license/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, machineId: machineId || null }),
      });
      setLabel("");
      setMachineId("");
      setCreating(false);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: string) {
    await fetch(`/api/license/keys/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await reload();
  }

  async function confirmRevoke() {
    if (!revoking) return;
    await act(revoking.id, revoking.revoked ? "unrevoke" : "revoke");
    setRevoking(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    await act(deleting.id, "delete");
    setDeleting(null);
  }

  const filtered = useMemo(
    () =>
      keys.filter(
        (k) =>
          !q ||
          (k.label ?? "").includes(q) ||
          k.humanKey.includes(q) ||
          (k.machineId ?? "").includes(q)
      ),
    [keys, q]
  );

  return (
    <div className="space-y-4">
      {!configured && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{labels.notConfigured}</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={() => { setLabel(""); setMachineId(""); setCreating(true); }} className="shrink-0">
          <Plus size={16} className="me-1" />
          {labels.mint}
        </Button>
        <div className="flex-1">
          <Input placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}

      <div className="space-y-2">
        {filtered.map((k) => (
          <div
            key={k.id}
            className="flex items-center gap-3 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-3"
            style={k.revoked ? { opacity: 0.55 } : undefined}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-(--text-secondary)">
              <KeyRound size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-sm font-black">{k.humanKey}</div>
              <div className="truncate text-xs opacity-60">
                {k.label ?? ""} {k.machineId ? `· ${k.machineId.slice(0, 12)}…` : `· ${labels.pool}`}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              {k.revoked ? (
                <Button variant="secondary" onClick={() => setRevoking(k)} className="h-8 px-3 text-xs">
                  {labels.unrevoke}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setRevoking(k)} className="h-8 px-3 text-xs">
                  {labels.revoke}
                </Button>
              )}
              {k.machineId && (
                <>
                  <Button variant="secondary" onClick={() => void act(k.id, "reset")} className="h-8 px-3 text-xs">
                    {labels.reset}
                  </Button>
                  <Button variant="secondary" onClick={() => void act(k.id, "end_trial")} className="h-8 px-3 text-xs">
                    {labels.endTrial}
                  </Button>
                </>
              )}
              <button
                type="button"
                title={labels.delete}
                aria-label={labels.delete}
                onClick={() => setDeleting(k)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15 text-red-500 transition-colors hover:bg-red-500/25"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-4">
        <h2 className="mb-2 text-sm font-bold">
          {labels.machines}
          <span className="ms-2 rounded-full bg-(--bg-sunken) px-2 py-0.5 text-xs font-black opacity-80">
            {machines.length}
          </span>
        </h2>
        {machines.length === 0 && <p className="text-sm opacity-60">{labels.empty}</p>}
        {machines.map((m) => (
          <div key={m.machineId} className="flex items-center gap-3 border-b border-(--border-subtle) py-2 text-sm last:border-0">
            <MonitorSmartphone size={16} className="shrink-0 opacity-50" />
            <span className="min-w-0 flex-1 truncate">{m.label ?? `${m.machineId.slice(0, 12)}…`}</span>
            <span className="shrink-0 text-xs opacity-60">{new Date(m.lastSeen).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={labels.mint}
        subtitle={labels.title}
        icon="+"
      >
        <div className="grid gap-2">
          <Input placeholder={labels.shopLabel} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder={labels.machine} value={machineId} onChange={(e) => setMachineId(e.target.value)} />
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={saving}>
              {labels.cancel}
            </Button>
            <Button onClick={mint} disabled={saving}>{saving ? "…" : labels.save}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={confirmRevoke}
        title={revoking?.revoked ? labels.unrevoke : labels.revoke}
        message={revoking?.humanKey ?? ""}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={labels.deleteTitle}
        message={deleting ? labels.deleteMessage.replace("{name}", deleting.humanKey) : ""}
      />
    </div>
  );
}
