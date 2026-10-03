"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Machine = {
  machineId: string;
  label: string | null;
  status: string;
  phone: string | null;
  contactName: string | null;
  city: string | null;
  trialEnd: string | null;
  activatedAt: string | null;
  lastSeen: string;
  deviceSpecs: Record<string, string> | null;
  subscription: { plan: string; status: string; expiresAt: string | null } | null;
};

type KeyRow = {
  id: string;
  humanKey: string;
  label: string | null;
  machineId: string | null;
  consumedByMachineId: string | null;
  revoked: boolean;
};

type IpRow = { ip: string; reason: string | null };

const STATUS_COLOR: Record<string, string> = {
  activated: "bg-emerald-500/10 text-emerald-600",
  pending: "bg-amber-500/10 text-amber-600",
  revoked: "bg-red-500/10 text-red-500",
};

const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none focus:border-(--brand-500)";

/// Vendor licensing console: machines (activate/lock/edit) + key pool +
/// IP blocks. Every action hits the audited superadmin APIs.
export function LicensesClient({ labels }: { labels: Record<string, string> }) {
  const [tab, setTab] = useState<"machines" | "keys" | "ips">("machines");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [ips, setIps] = useState<IpRow[]>([]);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null);
  const [mintOpen, setMintOpen] = useState(false);
  const [mintCount, setMintCount] = useState("5");
  const [mintLabel, setMintLabel] = useState("");
  const [ipInput, setIpInput] = useState("");
  const [ipReason, setIpReason] = useState("");
  const [editRow, setEditRow] = useState<Machine | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPlan, setEditPlan] = useState("");

  const load = useCallback(async () => {
    const [m, k, ips] = await Promise.all([
      fetch(`/api/superadmin/machines?status=${fStatus}&q=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/superadmin/keys", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/superadmin/blocked-ips", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ]);
    setMachines(m);
    setKeys(k);
    setIps(ips);
  }, [q, fStatus]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  async function machineAct(machineId: string, action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/machines/${encodeURIComponent(machineId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteMachine(machineId: string) {
    setBusy(true);
    try {
      await fetch(`/api/superadmin/machines/${encodeURIComponent(machineId)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function keyAct(id: string, action: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  async function keyDelete(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/superadmin/keys/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function mint() {
    setBusy(true);
    try {
      const res = await fetch("/api/superadmin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: Number(mintCount) || 1, label: mintLabel || null }),
      });
      if (res.ok) {
        setMintOpen(false);
        setMintLabel("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function blockIp() {
    if (!ipInput.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/superadmin/blocked-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: ipInput.trim(), reason: ipReason.trim() || null }),
      });
      if (res.ok) {
        setIpInput("");
        setIpReason("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function unblockIp(ip: string) {
    setBusy(true);
    try {
      await fetch(`/api/superadmin/blocked-ips?ip=${encodeURIComponent(ip)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const daysLeft = (iso: string | null) => {
    if (!iso) return "—";
    const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    return d < 0 ? labels.expired ?? "expired" : `${d}j`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-(--bg-sunken) p-1">
          {(["machines", "keys", "ips"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("min-h-10 rounded-lg px-3 py-1 text-xs font-black", tab === t ? "bg-(--brand-500) text-white" : "opacity-60")}
            >
              {labels[`tab_${t}`] ?? t}
            </button>
          ))}
        </div>
        {tab === "keys" && (
          <Button onClick={() => setMintOpen(true)} className="shrink-0">+ {labels.mint}</Button>
        )}
      </div>

      {tab === "machines" && (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm">
              <option value="">{labels.all}</option>
              {["pending", "activated", "revoked"].map((s) => (
                <option key={s} value={s}>{labels[`st_${s}`] ?? s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            {machines.map((m) => (
              <div key={m.machineId} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black">{m.label || m.machineId.slice(-6)}</div>
                    <div className="truncate font-mono text-[11px] opacity-50" dir="ltr">{m.machineId}</div>
                    {(m.contactName || m.phone || m.city) && (
                        <div className="truncate text-[11px] opacity-60">
                          {m.contactName ? <bdi dir="auto">{m.contactName}</bdi> : ""}
                          {m.contactName && (m.phone || m.city) ? " · " : ""}
                          {m.phone ? <bdi dir="ltr">{m.phone}</bdi> : ""}
                          {m.phone && m.city ? " · " : ""}
                          {m.city ? <bdi dir="auto">{m.city}</bdi> : ""}
                        </div>
                      )}
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-black", STATUS_COLOR[m.status] ?? "")}>
                    {labels[`st_${m.status}`] ?? m.status}
                  </span>
                </div>
                {m.deviceSpecs && Object.keys(m.deviceSpecs).length > 0 && (
                  <div className="mt-1 truncate text-[11px] opacity-50" dir="ltr">
                    {Object.entries(m.deviceSpecs).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(" · ")}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] opacity-70">
                  <span>{labels.trial}: {daysLeft(m.trialEnd)}</span>
                  {m.subscription && <span>{m.subscription.plan} · {m.subscription.status}</span>}
                  <span className="tabular-nums" dir="ltr">{new Date(m.lastSeen).toLocaleDateString()}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(m.status === "pending") && (
                    <Button onClick={() => void machineAct(m.machineId, "activate")} disabled={busy} className="h-9 px-3 text-xs">{labels.activate}</Button>
                  )}
                  {m.status === "revoked" ? (
                    <Button variant="secondary" onClick={() => void machineAct(m.machineId, "unrevoke")} disabled={busy} className="h-9 px-3 text-xs">{labels.unrevoke}</Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirm({
                        title: labels.revokeTitle,
                        message: `${labels.revokeMsg} (${m.label || m.machineId.slice(-6)})`,
                        run: () => machineAct(m.machineId, "revoke"),
                      })}
                      disabled={busy}
                      className="h-9 px-3 text-xs"
                    >
                      {labels.revoke}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => void machineAct(m.machineId, "end_trial")} disabled={busy} className="h-9 px-3 text-xs">{labels.endTrial}</Button>
                  <Button variant="secondary" onClick={() => { setEditRow(m); setEditLabel(m.label ?? ""); setEditPlan(m.subscription?.plan ?? ""); }} disabled={busy} className="h-9 px-3 text-xs">{labels.edit}</Button>
                  <Button
                    variant="secondary"
                    onClick={() => setConfirm({ title: labels.resetTitle, message: labels.resetMsg, run: () => machineAct(m.machineId, "reset") })}
                    disabled={busy} className="h-9 px-3 text-xs"
                  >
                    {labels.reset}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setConfirm({ title: labels.deleteTitle, message: labels.deleteMsg, run: () => deleteMachine(m.machineId) })}
                    disabled={busy} className="h-9 px-3 text-xs"
                  >
                    {labels.delete}
                  </Button>
                </div>
              </div>
            ))}
            {machines.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
          </div>
        </>
      )}

      {tab === "keys" && (
        <div className="space-y-1.5">
          {keys.map((k) => {
            const bound = k.consumedByMachineId ?? k.machineId;
            return (
              <div key={k.id} className="flex items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm font-black" dir="ltr">{k.humanKey}</div>
                  <div className="truncate text-[11px] opacity-60">
                    {k.label ?? "—"}{bound ? ` · ${bound.slice(-6)}` : ""}{k.revoked ? ` · ${labels.st_revoked}` : ""}
                  </div>
                </div>
                {!bound && !k.revoked && <span className="shrink-0 text-xs font-black text-emerald-600">○ {labels.free}</span>}
                <div className="flex max-w-full shrink-0 flex-wrap justify-end gap-1">
                  {k.revoked ? (
                    <Button variant="secondary" onClick={() => void keyAct(k.id, "unrevoke")} disabled={busy} className="h-10 px-2.5 text-[11px]">{labels.unrevoke}</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => void keyAct(k.id, "revoke")} disabled={busy} className="h-10 px-2.5 text-[11px]">{labels.revoke}</Button>
                  )}
                  {bound && (
                    <Button variant="secondary" onClick={() => void keyAct(k.id, "reset")} disabled={busy} className="h-10 px-2.5 text-[11px]">{labels.reset}</Button>
                  )}
                  <Button variant="secondary" onClick={() => void keyDelete(k.id)} disabled={busy} className="h-10 px-2.5 text-[11px]">{labels.delete}</Button>
                </div>
              </div>
            );
          })}
          {keys.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
        </div>
      )}

      {tab === "ips" && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input placeholder="IP" value={ipInput} onChange={(e) => setIpInput(e.target.value)} dir="ltr" />
            <Input placeholder={labels.reason} value={ipReason} onChange={(e) => setIpReason(e.target.value)} />
            <Button onClick={() => void blockIp()} disabled={busy || !ipInput.trim()} className="shrink-0">{labels.block}</Button>
          </div>
          {ips.map((r) => (
            <div key={r.ip} className="flex items-center justify-between gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2 text-sm">
              <span className="font-mono" dir="ltr">{r.ip}</span>
              <span className="min-w-0 flex-1 truncate text-xs opacity-60">{r.reason ?? ""}</span>
              <Button variant="secondary" onClick={() => void unblockIp(r.ip)} disabled={busy} className="h-8 shrink-0 px-2 text-[11px]">{labels.unblock}</Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { if (confirm) { await confirm.run(); setConfirm(null); } }}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={labels.confirm}
      />
      <Modal open={mintOpen} onClose={() => setMintOpen(false)} title={labels.mintTitle} width="sm">
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.count}</label>
            <Input type="number" min={1} max={100} value={mintCount} onChange={(e) => setMintCount(e.target.value)} dir="ltr" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.label}</label>
            <Input value={mintLabel} onChange={(e) => setMintLabel(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMintOpen(false)} className="flex-1">{labels.cancel}</Button>
            <Button onClick={() => void mint()} disabled={busy} className="flex-[2]">{labels.mint}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={editRow !== null} onClose={() => setEditRow(null)} title={labels.editTitle} width="sm">
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.label}</label>
            <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.plan}</label>
            <Input value={editPlan} onChange={(e) => setEditPlan(e.target.value)} dir="ltr" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditRow(null)} className="flex-1">{labels.cancel}</Button>
            <Button
              onClick={() => { if (editRow) void machineAct(editRow.machineId, "edit", { label: editLabel, plan: editPlan || undefined }).then(() => setEditRow(null)); }}
              disabled={busy} className="flex-[2]"
            >
              {labels.save}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
