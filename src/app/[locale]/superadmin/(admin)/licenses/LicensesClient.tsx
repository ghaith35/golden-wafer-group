"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";

type Machine = {
  machineId: string;
  label: string | null;
  workshop: string | null;
  status: string;
  phone: string | null;
  contactName: string | null;
  city: string | null;
  email: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  trialIp: string | null;
  lastIp: string | null;
  activationKey: string | null;
  activationType: string | null;
  consumedByMachineId: string | null;
  createdAt: string;
  activatedAt: string | null;
  lastSeen: string;
  deviceSpecs: Record<string, string | number> | null;
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

// ── Repaire-parity helpers (trial countdown, device specs summary) ──────────
function trialInfo(
  trialEnd: string | null,
  status: string,
  expiredLabel: string,
  hoursLeft: (n: number) => string,
  daysLeft: (n: number) => string
): { label: string; expired: boolean } | null {
  if (status !== "pending" || !trialEnd) return null;
  const msLeft = new Date(trialEnd).getTime() - Date.now();
  // 60s grace absorbs server/client skew so a just-ended trial reads expired.
  if (msLeft <= 60_000) return { label: expiredLabel, expired: true };
  if (msLeft < 86400_000) return { label: hoursLeft(Math.max(1, Math.ceil(msLeft / 3600_000))), expired: false };
  return { label: daysLeft(Math.ceil(msLeft / 86400_000)), expired: false };
}

function specSummary(s: Record<string, string | number> | null): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.cpu) parts.push(String(s.cpu).split("@")[0].trim());
  if (s.cores) parts.push(`${s.cores}c`);
  if (s.ramGB) parts.push(`${s.ramGB}GB`);
  return parts.join(" · ");
}

function specEntries(s: Record<string, string | number>): [string, string | number][] {
  const order = ["pcName", "platform", "arch", "cpu", "cores", "cpuSpeedMHz", "ramGB", "diskTotalGB", "diskFreeGB", "appVersion"];
  const entries = Object.entries(s);
  entries.sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return entries;
}

function displayName(m: Machine): string {
  return m.workshop || m.label || m.contactName || `${m.machineId.slice(0, 8)}…`;
}

/// Vendor licensing console (repaire parity): metrics + manual add + key pool
/// with fresh-key display + trials-by-IP anti-farming + full machine table
/// with conditional Activate / End-trial / Revoke (lock) / Unrevoke / Reset.
export function LicensesClient({ labels }: { labels: Record<string, string> }) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [ips, setIps] = useState<IpRow[]>([]);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null);
  // Manual add (repaire parity)
  const [newMachineId, setNewMachineId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  // Mint pool keys (repaire parity: fresh keys shown + single-key auto-copy)
  const [mintOpen, setMintOpen] = useState(false);
  const [mintCount, setMintCount] = useState("5");
  const [mintLabel, setMintLabel] = useState("");
  const [freshKeys, setFreshKeys] = useState<{ humanKey: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  // IP stats
  const [ipInput, setIpInput] = useState("");
  const [ipReason, setIpReason] = useState("");
  const [showIpStats, setShowIpStats] = useState(false);
  // Edit + specs modals (repaire parity: full seller-visible fields)
  const [editRow, setEditRow] = useState<Machine | null>(null);
  const [edit, setEdit] = useState({ label: "", workshop: "", contactName: "", phone: "", email: "", city: "" });
  const [editPlan, setEditPlan] = useState("");
  const [specRow, setSpecRow] = useState<Machine | null>(null);

  const load = useCallback(async () => {
    const [m, k, b] = await Promise.all([
      fetch(`/api/superadmin/machines?status=${fStatus}&q=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch("/api/superadmin/keys", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/superadmin/blocked-ips", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ]);
    const list = (Array.isArray(m) ? m : []) as Machine[];
    list.sort((a, b2) => {
      const rank = (s: string) => (s === "pending" ? 0 : s === "activated" ? 1 : 2);
      return rank(a.status) - rank(b2.status) || +new Date(b2.lastSeen) - +new Date(a.lastSeen);
    });
    setMachines(list);
    setKeys(Array.isArray(k) ? k : []);
    setIps(Array.isArray(b) ? b : []);
  }, [q, fStatus]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  async function machineAct(machineId: string, action: string, extra?: Record<string, unknown>) {
    setBusyKey(machineId + action);
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/machines/${encodeURIComponent(machineId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) await load();
      else {
        const d = await res.json().catch(() => ({}));
        alert((d as { error?: string }).error || "action_failed");
      }
    } finally {
      setBusy(false);
      setBusyKey(null);
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

  async function addMachine() {
    const id = newMachineId.trim();
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch("/api/superadmin/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: id, label: newLabel.trim() || undefined }),
      });
      if (!res.ok) alert("add_failed");
      setNewMachineId("");
      setNewLabel("");
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("generate_failed");
        return;
      }
      const rows = (data as { humanKey?: string }[] | { keys?: { humanKey: string }[] }) as unknown;
      const list: { humanKey: string }[] = Array.isArray(rows)
        ? (rows as { humanKey?: string }[]).map((r) => ({ humanKey: r.humanKey ?? "" })).filter((r) => r.humanKey)
        : (((data as { keys?: { humanKey: string }[] }).keys ?? []) as { humanKey: string }[]);
      // Fallback: reload gives us the newest rows when the shape differs.
      const fresh = list.length > 0 ? list : [];
      setFreshKeys(fresh);
      if (fresh.length === 1) {
        try {
          await navigator.clipboard.writeText(fresh[0].humanKey);
        } catch {
          /* ignore */
        }
      }
      setMintOpen(false);
      setMintLabel("");
      await load();
      // If the POST returned rows directly but we couldn't parse, refresh fresh from reload diff.
      if (fresh.length === 0) {
        await fetch("/api/superadmin/keys", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : []))
          .then((all: KeyRow[]) => {
            const n = Math.min(100, Math.max(1, Number(mintCount) || 1));
            setFreshKeys(all.slice(0, n).map((k) => ({ humanKey: k.humanKey })));
          })
          .catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  async function blockIpAddr(ip: string) {
    const clean = ip.trim();
    if (!clean) return;
    if (!window.confirm(`${labels.block}? ${clean}`)) return;
    setBusyKey("block:" + clean);
    try {
      const res = await fetch("/api/superadmin/blocked-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: clean, reason: ipReason.trim() || "manual block from console" }),
      });
      if (!res.ok) alert("block_failed");
      setIpInput("");
      setIpReason("");
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function unblockIp(ip: string) {
    setBusyKey("unblock:" + ip);
    try {
      await fetch(`/api/superadmin/blocked-ips?ip=${encodeURIComponent(ip)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  function copyKey(key: string) {
    try {
      void navigator.clipboard.writeText(key);
    } catch {
      /* ignore */
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  function openEdit(m: Machine) {
    setEditRow(m);
    setEdit({
      label: m.label ?? "",
      workshop: m.workshop ?? "",
      contactName: m.contactName ?? "",
      phone: m.phone ?? "",
      email: m.email ?? "",
      city: m.city ?? "",
    });
    setEditPlan(m.subscription?.plan ?? "");
  }

  async function saveEdit() {
    if (!editRow) return;
    await machineAct(editRow.machineId, "edit", {
      label: edit.label.trim(),
      workshop: edit.workshop.trim(),
      contactName: edit.contactName.trim(),
      phone: edit.phone.trim(),
      email: edit.email.trim(),
      city: edit.city.trim(),
      plan: editPlan.trim() || undefined,
    });
    setEditRow(null);
  }

  // Metrics (repaire parity): pending / active / available (free pool keys) / revoked.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of machines) c[m.status] = (c[m.status] ?? 0) + 1;
    c.available = keys.filter((k) => !k.machineId && !k.consumedByMachineId && !k.revoked).length;
    return c;
  }, [machines, keys]);

  const blockedSet = useMemo(() => new Set(ips.map((b) => b.ip)), [ips]);

  // Trials grouped by source IP — farming shows up as many machines, one IP.
  // Blocking is always manual; nothing auto-blocks.
  const ipStats = useMemo(() => {
    const map = new Map<string, { ip: string; trials: number; machines: string[]; lastTrial: string }>();
    for (const r of machines) {
      if (!r.trialIp) continue;
      const g = map.get(r.trialIp) ?? { ip: r.trialIp, trials: 0, machines: [], lastTrial: r.createdAt };
      g.trials += 1;
      g.machines.push(displayName(r));
      if (r.createdAt > g.lastTrial) g.lastTrial = r.createdAt;
      map.set(r.trialIp, g);
    }
    return [...map.values()].sort((a, b) => b.trials - a.trials);
  }, [machines]);

  const isBusy = (id: string) => busyKey !== null && busyKey.startsWith(id);

  /// Per-row action buttons (khiata rhythm): one definition shared by the
  /// desktop table and the mobile cards below.
  const actionsFor = (m: Machine, trial: ReturnType<typeof trialInfo>, preact: boolean) => (
    <div className="flex flex-wrap gap-1.5">
      {/* Repaire conditional actions — revoke (lock) only shows on activated. */}
      {m.status === "pending" && !preact && !trial?.expired && (
        <>
          <Button onClick={() => void machineAct(m.machineId, "activate")} disabled={isBusy(m.machineId)} className="h-9 px-3 text-xs">
            {labels.activate}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              setConfirm({
                title: labels.endTrial,
                message: `${labels.endTrial} (${displayName(m)})?`,
                run: () => machineAct(m.machineId, "end_trial"),
              })
            }
            disabled={isBusy(m.machineId)}
            className="h-9 px-3 text-xs"
          >
            {labels.endTrial}
          </Button>
        </>
      )}
      {m.status === "pending" && !preact && trial?.expired && (
        <Button onClick={() => void machineAct(m.machineId, "activate")} disabled={isBusy(m.machineId)} className="h-9 px-3 text-xs">
          {labels.activate}
        </Button>
      )}
      {m.status === "activated" && (
        <Button
          variant="destructive"
          onClick={() =>
            setConfirm({
              title: labels.revokeTitle,
              message: `${labels.revokeMsg} (${displayName(m)})`,
              run: () => machineAct(m.machineId, "revoke"),
            })
          }
          disabled={isBusy(m.machineId)}
          className="h-9 px-3 text-xs"
        >
          {labels.revoke}
        </Button>
      )}
      {m.status === "revoked" && (
        <Button variant="secondary" onClick={() => void machineAct(m.machineId, "unrevoke")} disabled={isBusy(m.machineId)} className="h-9 px-3 text-xs">
          {labels.unrevoke}
        </Button>
      )}
      {preact && m.consumedByMachineId && (
        <Button
          variant="secondary"
          onClick={() =>
            setConfirm({ title: labels.resetTitle, message: labels.resetMsg, run: () => machineAct(m.machineId, "reset") })
          }
          disabled={isBusy(m.machineId)}
          className="h-9 px-3 text-xs"
        >
          {labels.reset}
        </Button>
      )}
      <Button variant="secondary" onClick={() => openEdit(m)} disabled={busy} className="h-9 px-3 text-xs">
        {labels.edit}
      </Button>
      <Button
        variant="secondary"
        onClick={() => setConfirm({ title: labels.deleteTitle, message: labels.deleteMsg, run: () => deleteMachine(m.machineId) })}
        disabled={isBusy(m.machineId)}
        className="h-9 px-3 text-xs"
      >
        {labels.delete}
      </Button>
    </div>
  );
  const tInfo = (m: Machine) =>
    trialInfo(
      m.trialEnd,
      m.status,
      labels.expired ?? "expired",
      (n) => `${n}h`,
      (n) => `${n}j`
    );

  return (
    <div className="space-y-3">
      {/* Metrics */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={labels.st_pending ?? "Pending"} value={counts.pending ?? 0} />
        <Metric label={labels.st_activated ?? "Active"} value={counts.activated ?? 0} variant="active" />
        <Metric label={labels.free ?? "Free keys"} value={counts.available ?? 0} variant="available" />
        <Metric label={labels.st_revoked ?? "Locked"} value={counts.revoked ?? 0} variant="revoked" />
      </section>

      {/* Machines — one section, no tabs (repaire rhythm) */}
      <>
          {/* Manual add (repaire parity) */}
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
            <div className="min-w-0 flex-1 basis-52">
              <label className="mb-1 block text-[11px] font-black uppercase opacity-60">Machine ID</label>
              <Input value={newMachineId} onChange={(e) => setNewMachineId(e.target.value)} placeholder="machine-id…" dir="ltr" />
            </div>
            <div className="basis-40">
              <label className="mb-1 block text-[11px] font-black uppercase opacity-60">{labels.label}</label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="…" />
            </div>
            <Button onClick={() => void addMachine()} disabled={busy || !newMachineId.trim()} className="shrink-0">
              {labels.neW ?? "Add"}
            </Button>
          </div>

          {/* Trials by IP + manual blocking (repaire parity) */}
          <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay)">
            <button onClick={() => setShowIpStats((v) => !v)} aria-expanded={showIpStats} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start">
              <span className="text-[11px] font-black uppercase opacity-60">
                Trials by IP · {ipStats.length} IPs · {ips.length} blocked
              </span>
              <span className="text-xs font-bold opacity-70">{showIpStats ? "▲" : "▼"}</span>
            </button>
            {showIpStats && (
              <div className="space-y-2 border-t border-(--border-default) px-3 py-2.5">
                {ipStats.length === 0 ? (
                  <p className="text-xs opacity-60">No trial IPs yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {ipStats.slice(0, 20).map((g) => (
                      <div key={g.ip} className="flex items-center gap-2 text-xs">
                        <span dir="ltr" className="shrink-0 font-mono font-bold">
                          {g.ip}
                        </span>
                        <span className={cn("rounded-full px-2 py-0.5 font-black", g.trials >= 3 ? "bg-red-500/10 text-red-500" : "bg-(--bg-sunken) opacity-70")}>
                          {g.trials}
                        </span>
                        <span className="min-w-0 flex-1 truncate opacity-60" title={g.machines.join(", ")}>
                          {g.machines.join(", ")}
                        </span>
                        {blockedSet.has(g.ip) ? (
                          <Button variant="secondary" onClick={() => void unblockIp(g.ip)} disabled={isBusy("unblock:" + g.ip)} className="h-8 shrink-0 px-2 text-[11px]">
                            {labels.unblock}
                          </Button>
                        ) : (
                          <Button variant="secondary" onClick={() => void blockIpAddr(g.ip)} disabled={isBusy("block:" + g.ip)} className="h-8 shrink-0 px-2 text-[11px]">
                            {labels.block}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {ips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {ips.map((b) => (
                      <span key={b.ip} className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-red-500">
                        <span dir="ltr">{b.ip}</span>
                        <button onClick={() => void unblockIp(b.ip)} aria-label={`unblock ${b.ip}`} className="font-black">
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input placeholder="IP" value={ipInput} onChange={(e) => setIpInput(e.target.value)} dir="ltr" />
                  <Input placeholder={labels.reason} value={ipReason} onChange={(e) => setIpReason(e.target.value)} />
                  <Button variant="secondary" onClick={() => void blockIpAddr(ipInput)} disabled={busy || !ipInput.trim()} className="shrink-0">
                    {labels.block}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Input className="bg-white text-neutral-900 placeholder:text-neutral-400 focus:bg-white" placeholder={labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-11 shrink-0 rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm">
              <option value="">{labels.all}</option>
              {["pending", "activated", "revoked"].map((s) => (
                <option key={s} value={s}>
                  {labels[`st_${s}`] ?? s}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop table (khiata rhythm) — mobile cards below stay as-is. */}
          <div className="table-shell hidden lg:block">
            <table className="min-w-[1080px]">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Machine ID</th>
                  <th>Workshop</th>
                  <th>Contact</th>
                  <th>Device</th>
                  <th>IP</th>
                  <th>Key</th>
                  <th>Trial ends</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => {
                  const trial = tInfo(m);
                  const preact = (m.activationType ?? "machine") === "preactivated";
                  const available = preact && m.status === "activated" && !m.consumedByMachineId;
                  return (
                    <tr key={m.machineId}>
                      <td>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black", preact ? "pill-brand" : "pill-slate")}>
                          {preact ? "PREACT" : "MACH"}
                        </span>
                      </td>
                      <td className="nowrap font-mono" dir="ltr" title={m.machineId}>
                        {available ? (labels.free ?? "Available") : `${m.machineId.slice(0, 16)}…`}
                      </td>
                      <td className="nowrap">{m.workshop ?? m.label ?? "—"}</td>
                      <td className="nowrap">
                        {m.contactName ? <bdi dir="auto">{m.contactName}</bdi> : "—"}
                        {m.phone ? <bdi dir="ltr"> · {m.phone}</bdi> : ""}
                        {m.city ? <bdi dir="auto"> · {m.city}</bdi> : ""}
                      </td>
                      <td className="nowrap">
                        {m.deviceSpecs && Object.keys(m.deviceSpecs).length > 0 ? (
                          <button onClick={() => setSpecRow(m)} className="font-bold hover:opacity-100" dir="ltr">
                            {String(m.deviceSpecs.pcName ?? m.deviceSpecs.platform ?? "specs")} · {specSummary(m.deviceSpecs)}
                          </button>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                      <td className="nowrap font-mono" dir="ltr">
                        {m.lastIp ? (
                          <span className={blockedSet.has(m.lastIp) ? "font-bold text-red-500" : ""} title={m.trialIp && m.trialIp !== m.lastIp ? `trial: ${m.trialIp}` : undefined}>
                            {m.lastIp}
                          </span>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                      <td className="nowrap">
                        {m.activationKey ? (
                          <button onClick={() => copyKey(m.activationKey!)} title="click to copy" className="font-mono font-bold hover:opacity-80" dir="ltr">
                            {copied === m.activationKey ? "✓" : m.activationKey}
                          </button>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                      <td className="nowrap tabular-nums" dir="ltr">
                        {m.trialEnd ? (
                          <>
                            {new Date(m.trialEnd).toLocaleDateString()}{" "}
                            {trial && <b className={trial.expired ? "text-red-500" : ""}>{trial.label}</b>}
                          </>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>
                      <td>
                        <span className={cn("rounded-full px-2 py-1 text-[10px] font-black", STATUS_COLOR[m.status] ?? "")}>
                          {labels[`st_${m.status}`] ?? m.status}
                        </span>
                        {m.status === "pending" && trial && (
                          <div className={cn("mt-0.5 text-[11px] font-bold", trial.expired && "text-red-500")}>{trial.label}</div>
                        )}
                      </td>
                      <td>{actionsFor(m, trial, preact)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 lg:hidden">
            {machines.map((m) => {
              const trial = tInfo(m);
              const preact = (m.activationType ?? "machine") === "preactivated";
              const available = preact && m.status === "activated" && !m.consumedByMachineId;
              return (
                <div key={m.machineId} className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black", preact ? "bg-purple-500/10 text-purple-500" : "bg-(--bg-sunken) opacity-70")}>
                      {preact ? "PREACT" : "MACHINE"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black">{available ? (labels.free ?? "Available") : displayName(m)}</div>
                      <div className="truncate font-mono text-[11px] opacity-50" dir="ltr">
                        {m.machineId}
                      </div>
                      {(m.contactName || m.phone || m.email || m.city) && (
                        <div className="truncate text-[11px] opacity-60">
                          {m.contactName ? <bdi dir="auto">{m.contactName}</bdi> : ""}
                          {m.contactName && (m.phone || m.city || m.email) ? " · " : ""}
                          {m.phone ? <bdi dir="ltr">{m.phone}</bdi> : ""}
                          {m.email ? <bdi dir="ltr"> · {m.email}</bdi> : ""}
                          {m.city ? <bdi dir="auto"> · {m.city}</bdi> : ""}
                        </div>
                      )}
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-black", STATUS_COLOR[m.status] ?? "")}>
                      {labels[`st_${m.status}`] ?? m.status}
                    </span>
                  </div>
                  {m.deviceSpecs && Object.keys(m.deviceSpecs).length > 0 && (
                    <button onClick={() => setSpecRow(m)} className="mt-1 block max-w-full truncate text-start text-[11px] opacity-60 hover:opacity-100" dir="ltr">
                      <span className="font-bold">{String(m.deviceSpecs.pcName ?? m.deviceSpecs.platform ?? "specs")}</span>
                      <span> · {specSummary(m.deviceSpecs)}</span>
                    </button>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] opacity-70">
                    <span>
                      {labels.trial}:{" "}
                      {m.trialEnd ? (
                        <>
                          <span className="tabular-nums" dir="ltr">
                            {new Date(m.trialEnd).toLocaleDateString()}
                          </span>{" "}
                          {trial && <b className={trial.expired ? "text-red-500" : ""}>{trial.label}</b>}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                    {m.lastIp && (
                      <span dir="ltr" className={cn("font-mono", blockedSet.has(m.lastIp) && "font-bold text-red-500")} title={m.trialIp && m.trialIp !== m.lastIp ? `trial: ${m.trialIp}` : undefined}>
                        {m.lastIp}
                      </span>
                    )}
                    {m.activationKey && (
                      <button onClick={() => copyKey(m.activationKey!)} title="click to copy" className="font-mono font-bold hover:opacity-100">
                        {copied === m.activationKey ? "✓" : m.activationKey}
                      </button>
                    )}
                    {m.subscription && (
                      <span>
                        {m.subscription.plan} · {m.subscription.status}
                      </span>
                    )}
                    <span className="tabular-nums" dir="ltr">
                      {new Date(m.lastSeen).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="mt-2">{actionsFor(m, trial, preact)}</div>
                </div>
              );
            })}
            {machines.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
          </div>
      </>

      <div className="flex items-center justify-between gap-2 pt-2">
        <h2 className="text-sm font-black">{labels.tab_keys ?? "Keys"}</h2>
        <Button onClick={() => setMintOpen(true)} className="shrink-0">
          + {labels.mint}
        </Button>
      </div>
      {freshKeys.length > 0 && (
        <div className="rounded-2xl border border-(--brand-500)/40 bg-(--brand-500)/5 p-3">
          <p className="text-[11px] font-black uppercase tracking-wide opacity-70">Fresh keys — copy now</p>
          <div className="mt-2 space-y-1.5">
            {freshKeys.map((k) => (
              <div key={k.humanKey} className="flex items-center gap-2">
                <code dir="ltr" className="flex-1 select-all truncate rounded-lg bg-(--bg-surface) px-3 py-2 font-mono text-xs font-bold">
                  {k.humanKey}
                </code>
                <Button variant="secondary" onClick={() => copyKey(k.humanKey)} className="h-9 px-3 text-xs">
                  {copied === k.humanKey ? "✓" : labels.confirm ?? "Copy"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {mintOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
          <div className="w-28">
            <label className="mb-1 block text-[11px] font-black uppercase opacity-60">{labels.count}</label>
            <Input type="number" min={1} max={100} value={mintCount} onChange={(e) => setMintCount(e.target.value)} dir="ltr" />
          </div>
          <div className="min-w-0 flex-1 basis-40">
            <label className="mb-1 block text-[11px] font-black uppercase opacity-60">{labels.label}</label>
            <Input value={mintLabel} onChange={(e) => setMintLabel(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMintOpen(false)} className="flex-1">
              {labels.cancel}
            </Button>
            <Button onClick={() => void mint()} disabled={busy} className="flex-[2]">
              {labels.mint}
            </Button>
          </div>
        </div>
      )}
      {keys.length > 0 && (
        <div className="space-y-1.5">
          {keys.map((k) => {
            const bound = k.consumedByMachineId ?? k.machineId;
            return (
              <div key={k.id} className="flex items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) p-2.5">
                <div className="min-w-0 flex-1">
                  <button onClick={() => copyKey(k.humanKey)} title="click to copy" className="block max-w-full truncate text-start font-mono text-sm font-black hover:opacity-80" dir="ltr">
                    {copied === k.humanKey ? "✓ copied" : k.humanKey}
                  </button>
                  <div className="truncate text-[11px] opacity-60">
                    {k.label ?? "—"}
                    {bound ? ` · ${bound.slice(-6)}` : ""}
                    {k.revoked ? ` · ${labels.st_revoked}` : ""}
                  </div>
                </div>
                {!bound && !k.revoked && <span className="shrink-0 text-xs font-black text-emerald-600">○ {labels.free}</span>}
                <div className="flex max-w-full shrink-0 flex-wrap justify-end gap-1">
                  {k.revoked ? (
                    <Button variant="secondary" onClick={() => void keyAct(k.id, "unrevoke")} disabled={busy} className="h-10 px-2.5 text-[11px]">
                      {labels.unrevoke}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => void keyAct(k.id, "revoke")} disabled={busy} className="h-10 px-2.5 text-[11px]">
                      {labels.revoke}
                    </Button>
                  )}
                  {bound && (
                    <Button variant="secondary" onClick={() => void keyAct(k.id, "reset")} disabled={busy} className="h-10 px-2.5 text-[11px]">
                      {labels.reset}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => void keyDelete(k.id)} disabled={busy} className="h-10 px-2.5 text-[11px]">
                    {labels.delete}
                  </Button>
                </div>
              </div>
            );
          })}
          {keys.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
        </div>
      )}

      <h2 className="pt-2 text-sm font-black">{labels.tab_ips ?? "IPs"}</h2>
      {(
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input placeholder="IP" value={ipInput} onChange={(e) => setIpInput(e.target.value)} dir="ltr" />
            <Input placeholder={labels.reason} value={ipReason} onChange={(e) => setIpReason(e.target.value)} />
            <Button onClick={() => void blockIpAddr(ipInput)} disabled={busy || !ipInput.trim()} className="shrink-0">
              {labels.block}
            </Button>
          </div>
          {ips.map((r) => (
            <div key={r.ip} className="flex items-center justify-between gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-3 py-2 text-sm">
              <span className="font-mono" dir="ltr">
                {r.ip}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs opacity-60">{r.reason ?? ""}</span>
              <Button variant="secondary" onClick={() => void unblockIp(r.ip)} disabled={busy} className="h-8 shrink-0 px-2 text-[11px]">
                {labels.unblock}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) {
            await confirm.run();
            setConfirm(null);
          }
        }}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={labels.confirm}
      />

      {/* Full edit modal (repaire parity) */}
      <Modal open={editRow !== null} onClose={() => setEditRow(null)} title={labels.editTitle} width="sm">
        <div className="space-y-2">
          {(
            [
              ["label", labels.label],
              ["workshop", "Workshop"],
              ["contactName", "Contact"],
              ["phone", labels.phone ?? "Phone"],
              ["email", "Email"],
              ["city", "City"],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{label}</label>
              <Input value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} dir={k === "phone" || k === "email" ? "ltr" : undefined} />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.plan}</label>
            <Input value={editPlan} onChange={(e) => setEditPlan(e.target.value)} dir="ltr" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditRow(null)} className="flex-1">
              {labels.cancel}
            </Button>
            <Button onClick={() => void saveEdit()} disabled={busy} className="flex-[2]">
              {labels.save}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Device specs modal (repaire parity) */}
      <Modal open={specRow !== null && !!specRow?.deviceSpecs} onClose={() => setSpecRow(null)} title="Device specs" width="sm">
        <div className="space-y-2">
          <p className="truncate font-mono text-xs opacity-60" dir="ltr">
            {specRow?.machineId}
          </p>
          {specRow?.deviceSpecs &&
            specEntries(specRow.deviceSpecs).map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-3 rounded-lg bg-(--bg-sunken) px-3 py-2">
                <dt className="text-[11px] font-black uppercase opacity-60">{k}</dt>
                <dd dir="ltr" className="max-w-60 truncate text-right text-xs font-semibold" title={String(v)}>
                  {String(v)}
                </dd>
              </div>
            ))}
          <Button variant="secondary" onClick={() => setSpecRow(null)} className="w-full">
            {labels.cancel ?? "Close"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Metric({ label, value, variant }: { label: string; value: number; variant?: "active" | "revoked" | "available" }) {
  const color =
    variant === "active"
      ? "text-emerald-600"
      : variant === "revoked"
        ? "text-red-500"
        : variant === "available"
          ? "text-purple-500"
          : "";
  return (
    <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
      <div className="text-[10px] font-black uppercase opacity-60">{label}</div>
      <div className={cn("mt-1 text-2xl font-black tabular-nums", color)}>{value}</div>
    </div>
  );
}
