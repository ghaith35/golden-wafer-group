"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Banknote, ClipboardList, Package, Plus, ReceiptText, RefreshCw, Truck, UserPlus, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { queueOp, getLastSync, pendingCount } from "@/lib/sync/client";
import { SyncModal } from "@/components/sync/SyncModal";
import { dzMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/// Step 3 — Dashboard hub: sale, factures, commande, commandes, stock, sync.
export function DashClient({
  locale,
  day,
  vanId,
  vanName,
  client,
  dayCount,
  dayTotal,
  readyCount,
  tournee,
  labels,
}: {
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  client: { id: string; name: string; code: string; phone: string | null; balance: unknown } | null;
  dayCount: number;
  dayTotal: number;
  readyCount: number;
  tournee: { id: string; status: string; startedAt: string | null; finishedAt: string | null } | null;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  /// Till declaration state.
  const [tillOpen, setTillOpen] = useState(false);
  const [tillAmount, setTillAmount] = useState("");
  const [tillNotes, setTillNotes] = useState("");
  const [tillSaving, setTillSaving] = useState(false);
  const [tillMsg, setTillMsg] = useState<string | null>(null);
  const [tillError, setTillError] = useState<string | null>(null);
  /// Day-stamp offline state.
  const [dayPending, setDayPending] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  /// Sync popup (both directions + progress bar).
  const [syncOpen, setSyncOpen] = useState(false);
  const [stamp, setStamp] = useState<{ startedAt: string | null; finishedAt: string | null } | null>(
    tournee ? { startedAt: tournee.startedAt, finishedAt: tournee.finishedAt } : null
  );
  const [stamping, setStamping] = useState(false);
  // Live elapsed counter while the day is open.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!stamp?.startedAt || stamp.finishedAt) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [stamp?.startedAt, stamp?.finishedAt]);
  const qs = client ? `?client=${client.id}` : "";

  async function stampDay(kind: "start" | "finish") {
    if (!tournee || stamping) return;
    setStamping(true);
    setDayError(null);
    try {
      const res = await fetch(`/api/tournees/${tournee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: kind }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d) {
        setStamp({ startedAt: d.startedAt ?? null, finishedAt: d.finishedAt ?? null });
        setDayPending(false);
        return;
      }
      setDayError(d?.error ?? "failed");
    } catch {
      // Offline: queue the stamp, show it optimistically as pending.
      try {
        await queueOp(kind === "start" ? "day-start" : "day-finish", { tourneeId: tournee.id });
        const now = new Date().toISOString();
        setStamp((s) => ({
          startedAt: kind === "start" ? now : (s?.startedAt ?? null),
          finishedAt: kind === "finish" ? now : (s?.finishedAt ?? null),
        }));
        setDayPending(true);
      } catch {
        setDayError("save_failed");
      }
    } finally {
      setStamping(false);
    }
  }

  async function refreshSync() {
    try {
      setPending(await pendingCount());
      setLastSync(getLastSync());
    } catch { /* no indexeddb */ }
  }
  useEffect(() => {
    void refreshSync();
  }, []);

  /// Declare the counted till for TODAY (online, else queued for sync).
  async function submitTill() {
    if (tillSaving || tillAmount === "") return;
    setTillSaving(true);
    setTillError(null);
    setTillMsg(null);
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const body = { vanId, date: iso, amount: Number(tillAmount), notes: tillNotes.trim() || null };
    try {
      const res = await fetch("/api/cash-daily/declare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setTillError(d?.error ?? "failed");
        return;
      }
      setTillMsg(labels.declaredOk ?? "saved");
      setTillAmount("");
      setTillNotes("");
    } catch {
      try {
        await queueOp("cash-declare", { vanId, dateIso: iso, amount: Number(tillAmount), notes: tillNotes.trim() || null });
        setTillMsg(labels.queuedOk ?? "queued");
        setTillAmount("");
        setTillNotes("");
        void refreshSync();
      } catch {
        setTillError("save_failed");
      }
    } finally {
      setTillSaving(false);
    }
  }

  const tiles: Array<{ key: string; label: string; badge?: number; Icon: typeof Plus; cls: string; go: () => void }> = [
    { key: "sale", label: labels.newSale, Icon: Plus, cls: "bg-(--brand-500) text-white", go: () => router.push(`/${locale}/livreur/${day}/vente${qs}`) },
    { key: "factures", label: labels.factures, Icon: ReceiptText, cls: "bg-sky-500/15 text-sky-600", go: () => router.push(`/${locale}/livreur/${day}/factures`) },
    { key: "order", label: labels.newCommand, Icon: ClipboardList, cls: "bg-violet-500/15 text-violet-500", go: () => router.push(`/${locale}/livreur/${day}/commande${qs}`) },
    { key: "orders", label: labels.commandes, Icon: ClipboardList, cls: "bg-indigo-500/15 text-indigo-500", go: () => router.push(`/${locale}/livreur/${day}/commandes`) },
    { key: "ready", label: labels.ready, badge: readyCount, Icon: Truck, cls: "bg-emerald-500/15 text-emerald-600", go: () => router.push(`/${locale}/livreur/${day}/commandes?ready=1`) },
    { key: "stock", label: labels.stock, Icon: Package, cls: "bg-amber-500/15 text-amber-600", go: () => router.push(`/${locale}/livreur/${day}/stock`) },
    { key: "till", label: labels.declare, Icon: Banknote, cls: "bg-lime-500/15 text-lime-600", go: () => { setTillOpen(true); setTillMsg(null); } },
    { key: "client", label: labels.newClient, Icon: UserPlus, cls: "bg-teal-500/15 text-teal-600", go: () => router.push(`/${locale}/livreur/${day}/clients/new`) },
    { key: "dayClients", label: labels.clients, Icon: UserRound, cls: "bg-cyan-500/15 text-cyan-600", go: () => router.push(`/${locale}/livreur/${day}`) },
  ];

  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => router.push(`/${locale}/livreur/${day}`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.title}</h1>
          <p className="truncate text-xs opacity-60">{vanName}</p>
        </div>
      </div>

      {client && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-(--brand-500) bg-(--brand-500)/5 p-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500) text-white">
            <UserRound size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-black">{client.name}</div>
            <div className="truncate font-mono text-[11px] opacity-60" dir="ltr">{client.code}</div>
          </div>
          <button
            onClick={() => router.push(`/${locale}/livreur/${day}`)}
            className="shrink-0 rounded-lg bg-(--bg-sunken) px-3 py-2 text-xs font-black"
          >
            {labels.clients}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 text-center">
          <ReceiptText size={18} className="mx-auto text-(--brand-600)" />
          <div className="mt-1 text-xl font-black tabular-nums">{dayCount}</div>
        </div>
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 text-center">
          <Wallet size={18} className="mx-auto text-(--brand-600)" />
          <div className="mt-1 truncate text-xl font-black tabular-nums" dir="ltr">{dzMoney(dayTotal)}</div>
        </div>
      </div>

      {tournee && tournee.status === "OPEN" ? (
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-bold opacity-60">
            <span>{labels.startDay}</span>
            <span className="tabular-nums" dir="ltr">
              {stamp?.startedAt ? new Date(stamp.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—"}
              {dayPending && !stamp?.startedAt ? ` ⏳` : ""}
            </span>
          </div>
          <div className="mb-2 flex items-center justify-between text-xs font-bold opacity-60">
            <span>{labels.finishDay}</span>
            <span className="tabular-nums" dir="ltr">
              {stamp?.finishedAt ? new Date(stamp.finishedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—"}
              {dayPending && stamp?.startedAt && !stamp?.finishedAt ? ` ⏳` : ""}
            </span>
          </div>
          {stamp?.startedAt && (() => {
            const end = stamp.finishedAt ? new Date(stamp.finishedAt).getTime() : nowTick;
            const s = Math.max(0, Math.floor((end - new Date(stamp.startedAt).getTime()) / 1000));
            const hh = String(Math.floor(s / 3600)).padStart(2, "0");
            const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
            const ss = String(s % 60).padStart(2, "0");
            return (
              <div className="mb-2 flex items-center justify-between rounded-xl bg-(--brand-500)/10 px-3 py-2">
                <span className="text-xs font-black text-(--brand-600)">{labels.elapsed}</span>
                <span className="font-mono text-lg font-black tabular-nums text-(--brand-600)" dir="ltr">
                  {hh}:{mm}:{ss}
                </span>
              </div>
            );
          })()}
          <div className="flex gap-2">
            {!stamp?.startedAt ? (
              <Button onClick={() => void stampDay("start")} disabled={stamping} className="h-12 flex-1 text-base">
                {labels.startDay}
              </Button>
            ) : !stamp?.finishedAt ? (
              <Button onClick={() => void stampDay("finish")} disabled={stamping} variant="secondary" className="h-12 flex-1 text-base">
                {labels.finishDay}
              </Button>
            ) : null}
          </div>
          {dayPending && (
            <p className="mt-2 rounded-xl bg-amber-500/10 p-2 text-xs font-bold text-amber-600">{labels.dayQueued ?? ""}</p>
          )}
          {dayError && (
            <p className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500">{dayError}</p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-(--border-default) p-3 text-center text-xs font-bold opacity-60">
          {labels.noTournee ?? ""}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ key, label, badge, Icon, cls, go }) => (
          <button
            key={key}
            onClick={go}
            className="relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 shadow-sm transition-all active:scale-[0.98]"
          >
            {(badge ?? 0) > 0 && (
              <span className="absolute end-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-(--brand-500) px-1.5 text-[11px] font-black text-white tabular-nums">
                {badge}
              </span>
            )}
            <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", cls)}>
              <Icon size={20} />
            </span>
            <span className="text-[13px] font-black">{label}</span>
          </button>
        ))}
        <button
          onClick={() => setSyncOpen(true)}
          className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3 shadow-sm transition-all active:scale-[0.98]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
            <RefreshCw size={20} />
          </span>
          <span className="text-[13px] font-black">{labels.syncT}{pending > 0 ? ` (${pending})` : ""}</span>
          <span className="text-[10px] opacity-50">
            {lastSync ? `${labels.lastSync}: ${new Date(lastSync).toLocaleTimeString()}` : labels.pending}
          </span>
        </button>
      </div>

      <SyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onDone={() => void refreshSync()}
        labels={{
          title: labels.syncTitle, upload: labels.syncUpload, download: labels.syncDownload,
          images: labels.syncImages, applied: labels.syncApplied, failed: labels.syncFailed,
          remaining: labels.syncRemaining, start: labels.syncStart, close: labels.syncClose,
          up: labels.syncUp, down: labels.syncDown,
          setupHint: labels.syncSetupHint, scanSetup: labels.syncScanSetup, manual: labels.syncManual,
          gallery: labels.syncGallery, qrNotFound: labels.syncQrNotFound, invalidQr: labels.syncInvalidQr,
          tokenPh: labels.syncTokenPh, urlPh: labels.syncUrlPh, tokenRequired: labels.syncTokenRequired,
          saveConfig: labels.syncSaveConfig, resetConfig: labels.syncResetConfig,
          serverTitle: labels.syncServerTitle, changeServer: labels.syncChangeServer,
          serverScanHint: labels.syncServerScanHint, serverPendingBlock: labels.syncServerPendingBlock,
          serverQuarantined: labels.syncServerQuarantined, serverReset: labels.syncServerReset,
          webUpdateTitle: labels.syncWebUpdateTitle, webLater: labels.syncWebLater, webValidate: labels.syncWebValidate,
          nativeTitle: labels.syncNativeTitle, nativeGo: labels.syncNativeGo,
          history: labels.syncHistory, noHistory: labels.syncNoHistory, clearHistory: labels.syncClearHistory,
          camNeedHttps: labels.syncCamNeedHttps, camDenied: labels.syncCamDenied, camUnsupported: labels.syncCamUnsupported,
          directSync: labels.syncDirectSync, noVan: labels.syncNoVan,
          updateTitle: labels.syncUpdateTitle, checkUpdate: labels.syncCheckUpdate,
          webOk: labels.syncWebOk, webNew: labels.syncWebNew, updateNow: labels.syncUpdateNow,
          downloadApk: labels.syncDownloadApk, apkHint: labels.syncApkHint,
        }}
      />

      {/* تسليم الصندوق: counted till → DECLARED (online, else queued). */}
      <Modal open={tillOpen} onClose={() => setTillOpen(false)} title={labels.declare} subtitle={vanName} icon="💵" width="sm">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.amount}</label>
            <Input type="number" min={0} step="any" value={tillAmount} onChange={(e) => setTillAmount(e.target.value)} dir="ltr" inputMode="decimal" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.notes}</label>
            <Input value={tillNotes} onChange={(e) => setTillNotes(e.target.value)} />
          </div>
          {tillMsg && <p className="rounded-xl bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-600">{tillMsg}</p>}
          {tillError && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{tillError}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setTillOpen(false)} className="flex-1">{labels.cancel}</Button>
            <Button onClick={() => void submitTill()} disabled={tillSaving || tillAmount === ""} className="flex-[2]">
              {tillSaving ? "…" : labels.save}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
