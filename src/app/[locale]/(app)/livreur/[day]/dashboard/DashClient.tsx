"use client";

import { ClientName } from "@/components/clients/ClientName";
import { useEffect, useMemo, useState } from "react";
import { ApkOnly } from "@/components/layout/ApkOnly";
import { useRouter } from "next/navigation";
import { ArrowLeft, Banknote, ClipboardList, Lock, Package, PackageCheck, Plus, ReceiptText, RefreshCw, ShoppingBag, Truck, UserPlus, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ErrText } from "@/components/ui/ErrText";
import { useJourneeState } from "@/lib/journee";
import { queueOp, getLastSync, pendingCount, getPendingClients, goPage, warmJourneePages } from "@/lib/sync/client";
import { OnlineBadge } from "@/components/sync/OnlineBadge";
import { SyncModal } from "@/components/sync/SyncModal";
import { FirstRunWarmup } from "@/components/sync/FirstRunWarmup";
import { dzMoney } from "@/lib/format";
import { canSell } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import { todaySlug } from "../../_days";
import { ClosedShopButton, useClosedIds } from "@/components/livreur/ClosedShopButton";

/// Step 3 — Dashboard hub: sale, factures, commande, commandes, stock, sync.
export function DashClient({
  locale,
  day,
  vanId,
  vanName,
  client,
  closedToday = [],
  dayCount: dayCountP,
  dayTotal: dayTotalP,
  readyCount,
  tournee: tourneeP,
  dueCash: dueCashP,
  declared: declaredP,
  role,
  labels,
}: {
  locale: string;
  day: string;
  vanId: string;
  vanName: string;
  closedToday?: string[];
  client: { id: string; name: string; code: string; phone: string | null; gpsLat?: number | string | null; gpsLng?: number | string | null; balance: unknown } | null;
  dayCount: number;
  dayTotal: number;
  readyCount: number;
  tournee: { id: string; status: string; startedAt: string | null; finishedAt: string | null; autoClosed?: boolean | null } | null;
  dueCash: number;
  declared: number | null;
  role: string;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  /// Offline on a NEW day the service worker relabels the last cached copy
  /// (window.__DILI_DAY_SHIFTED): its server-side figures belong to the old
  /// day, so today starts clean — no old totals, no old tour to stamp.
  /// Read after mount so hydration still matches the served HTML.
  const [shifted, setShifted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount gate
    if ((window as unknown as { __DILI_DAY_SHIFTED?: string }).__DILI_DAY_SHIFTED) setShifted(true);
  }, []);
  const dayCount = shifted ? 0 : dayCountP;
  const dayTotal = shifted ? 0 : dayTotalP;
  const tournee = shifted ? null : tourneeP;
  const dueCash = shifted ? 0 : dueCashP;
  const declared = shifted ? null : declaredP;
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  /// Till declaration state (pre-filled from his sales — still editable).
  const [tillOpen, setTillOpen] = useState(false);
  const [tillAmount, setTillAmount] = useState("");
  const [tillNotes, setTillNotes] = useState("");
  const [tillSaving, setTillSaving] = useState(false);
  const [tillMsg, setTillMsg] = useState<string | null>(null);
  const [tillError, setTillError] = useState<string | null>(null);
  /// Day-stamp offline state.
  const [dayPending, setDayPending] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const [dayAuto, setDayAuto] = useState(false);
  /// Sync popup (both directions + progress bar).
  const [syncOpen, setSyncOpen] = useState(false);
  const [stampRaw, setStamp] = useState<{ startedAt: string | null; finishedAt: string | null } | null>(
    tournee ? { startedAt: tournee.startedAt, finishedAt: tournee.finishedAt } : null
  );
  const [stamping, setStamping] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset once the day is known to be a relabelled copy
    if (shifted) setStamp(null);
  }, [shifted]);
  /// Fin-journée recap (warns, never blocks).
  const [finishOpen, setFinishOpen] = useState(false);
  // Live elapsed counter while the day is open.
  const [nowTick, setNowTick] = useState(() => Date.now());
  /// Mounted flag: the ticking seconds must not render during hydration —
  /// server HTML seconds never equal the client's (React #418), so the
  /// timer appears right after mount instead.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  /// A journée ends with its own day: once that Algiers day is over, an open
  /// one counts as finished at 23:59:59 of that day — the timer stops there
  /// instead of running into the next day (the server stamps the same instant).
  const dayEndMs = useMemo(() => {
    // The journée is always today's, whatever day is picked in the URL.
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(todaySlug());
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 22, 59, 59, 999) : null;
  }, []);
  const pastEnd = mounted && dayEndMs != null && nowTick > dayEndMs;
  const stamp = useMemo(
    () => (stampRaw?.startedAt && !stampRaw.finishedAt && pastEnd ? { ...stampRaw, finishedAt: new Date(dayEndMs as number).toISOString() } : stampRaw),
    [stampRaw, pastEnd, dayEndMs],
  );
  useEffect(() => {
    if (!stamp?.startedAt || stamp.finishedAt) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [stamp?.startedAt, stamp?.finishedAt]);
  /// Client resolved on-device when the URL carries an unsynced one
  /// (?client=pending:<opId>): the server can't know it yet.
  const [pendClient, setPendClient] = useState<typeof client>(null);
  useEffect(() => {
    if (client) return;
    let dead = false;
    (async () => {
      try {
        const m = /[?&]client=(pending%3A[^&]+|pending:[^&]+)/.exec(window.location.search);
        if (!m) return;
        const id = decodeURIComponent(m[1]);
        const pend = await getPendingClients();
        const hit = pend.find((p) => `pending:${p.opId}` === id);
        if (hit && !dead) setPendClient({ id, name: hit.name, code: hit.code, phone: hit.phone, balance: 0 });
      } catch { /* stay client-less */ }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const effClient = client ?? pendClient;
  const closedState = useClosedIds(closedToday);
  const qs = effClient ? `?client=${effClient.id}` : "";

  /// Best-effort GPS fix for day stamps (never blocks).
  async function stampPos(): Promise<{ lat: number; lng: number } | null> {
    try {
      if (!("geolocation" in navigator)) return null;
      const p: GeolocationPosition = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 })
      );
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch {
      return null;
    }
  }

  async function stampDay(kind: "start" | "finish") {
    if (!tournee || stamping) return;
    setStamping(true);
    setDayError(null);
    const pos = await stampPos();
    const geo = pos ? { lat: pos.lat, lng: pos.lng } : {};
    try {
      const res = await fetch(`/api/tournees/${tournee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: kind, ...geo }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d) {
        setStamp({ startedAt: d.startedAt ?? null, finishedAt: d.finishedAt ?? null });
        setDayPending(false);
        // The system ended a past journée (he never closed it in time) —
        // say so plainly instead of a silent finished state.
        if (d.autoClosed) setDayAuto(true);
        if (kind === "finish") setFinishOpen(false);
        return;
      }
      setDayError(d?.error ?? "failed");
    } catch {
      // Offline: queue the stamp, show it optimistically as pending.
      try {
        await queueOp(kind === "start" ? "day-start" : "day-finish", { tourneeId: tournee.id, ...geo });
        const now = new Date().toISOString();
        setStamp((s) => ({
          startedAt: kind === "start" ? now : (s?.startedAt ?? null),
          finishedAt: kind === "finish" ? now : (s?.finishedAt ?? null),
        }));
        setDayPending(true);
        if (kind === "finish") setFinishOpen(false);
      } catch {
        setDayError("save_failed");
      }
    } finally {
      setStamping(false);
    }
  }

  /// Open the fin-journée recap with a fresh pending-ops count.
  async function openFinish() {
    setDayError(null);
    try {
      setPending(await pendingCount());
    } catch { /* keep last known */ }
    setFinishOpen(true);
  }

  async function refreshSync() {
    try {
      setPending(await pendingCount());
      setLastSync(getLastSync());
    } catch { /* no indexeddb */ }
  }
  useEffect(() => {
    void refreshSync();
    // Warm the journée pages while online so everything works fully offline.
    // The exact current URL first (query included: dashboard?client=X is a
    // different cache entry than the bare dashboard).
    warmJourneePages(locale, day, role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /// Declare the counted till for TODAY (online, else queued for sync).
  /// The amount comes pre-filled with the auto-computed due cash
  /// (his sales collected + payments − expenses − cash returns).
  function openTill() {
    setTillMsg(null);
    setTillError(null);
    if (tillAmount === "" && Number.isFinite(dueCash) && dueCash > 0) {
      setTillAmount(String(Math.round(dueCash * 100) / 100));
    }
    setTillOpen(true);
  }
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

  /// Tour workflow: sales/orders only while the tour runs (admins are never
  /// locked). Goods requests are open at any time, tour running or not.
  const jstate = useJourneeState(stamp, todaySlug());
  const lockedKeys: string[] = role === "Admin" ? [] : jstate === "active" ? [] : ["sale", "order"];

  const tiles: Array<{ key: string; label: string; badge?: number; Icon: typeof Plus; cls: string; go: () => void }> = [
    // Row 1: the three "new" actions. Then factures → orders → restock, then the rest.
    { key: "sale", label: labels.newSale, Icon: Plus, cls: "bg-(--brand-500) text-(--brand-contrast)", go: () => goPage(router, `/${locale}/livreur/${day}/vente${qs}`) },
    { key: "order", label: labels.newCommand, Icon: ShoppingBag, cls: "bg-violet-500/15 text-violet-500", go: () => goPage(router, `/${locale}/livreur/${day}/commande${qs}`) },
    { key: "newClient", label: labels.newClient, Icon: UserPlus, cls: "bg-emerald-500/15 text-emerald-600", go: () => goPage(router, `/${locale}/livreur/${day}/clients/new`) },
    { key: "factures", label: labels.factures, Icon: ReceiptText, cls: "bg-sky-500/15 text-sky-600", go: () => goPage(router, `/${locale}/livreur/${day}/factures`) },
    { key: "orders", label: labels.commandes, Icon: ClipboardList, cls: "bg-indigo-500/15 text-indigo-500", go: () => goPage(router, `/${locale}/livreur/${day}/commandes`) },
    { key: "demande", label: labels.restock ?? "Restock", Icon: PackageCheck, cls: "bg-teal-500/15 text-teal-600", go: () => goPage(router, `/${locale}/livreur/${day}/demande`) },
    { key: "ready", label: labels.ready, badge: readyCount, Icon: Truck, cls: "bg-emerald-500/15 text-emerald-600", go: () => goPage(router, `/${locale}/livreur/${day}/commandes?ready=1`) },
    { key: "stock", label: role === "Vendeur" ? (labels.stockDepot ?? labels.stock) : labels.stock, Icon: Package, cls: "bg-amber-500/15 text-amber-600", go: () => goPage(router, `/${locale}/livreur/${day}/stock`) },
    { key: "till", label: labels.declare, Icon: Banknote, cls: "bg-lime-500/15 text-lime-600", go: () => { openTill(); } },
    { key: "expense", label: labels.expense, Icon: Wallet, cls: "bg-orange-500/15 text-orange-600", go: () => goPage(router, `/${locale}/livreur/${day}/expenses`) },
    { key: "dayClients", label: labels.clients, Icon: UserRound, cls: "bg-cyan-500/15 text-cyan-600", go: () => goPage(router, `/${locale}/livreur/${day}`) },
  ];
  // Vendeur (مندوب): orders/stock/expenses only — no sale creation, no
  // factures, no restock requests, no "ready to deliver" lane, no till
  // (cash-box) declaration. Money side = expenses only.
  const notSeller = ["sale", "factures", "demande"];
  const vendeurOnly = ["ready", "till"];
  const visibleTiles = canSell(role)
    ? tiles
    : tiles.filter((t) => !notSeller.includes(t.key) && (role !== "Vendeur" || !vendeurOnly.includes(t.key)));

  return (
    <div className="space-y-3 p-4 pb-8 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, `/${locale}/livreur/${day}`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.title}</h1>
          <p className="truncate text-xs opacity-60">{vanName} · <time dateTime={todaySlug().split("-").map((part) => part.padStart(2, "0")).join("-")} dir="ltr">{todaySlug()}</time></p>
        </div>
        <ApkOnly><OnlineBadge onlineLabel={labels.online ?? "online"} offlineLabel={labels.offline ?? "offline"} /></ApkOnly>
      </div>

      {effClient && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-(--brand-500) bg-(--brand-500)/5 p-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500) text-(--brand-contrast)">
            <UserRound size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1 text-base font-black"><ClientName name={effClient.name} lat={(effClient as { gpsLat?: number | string | null }).gpsLat} lng={(effClient as { gpsLng?: number | string | null }).gpsLng} />{effClient.id.startsWith("pending:") ? <span className="shrink-0">⏳</span> : null}</div>
            <div className="truncate font-mono text-[11px] opacity-60" dir="ltr">{effClient.code}</div>
          </div>
          <button
            onClick={() => goPage(router, `/${locale}/livreur/${day}`)}
            className="shrink-0 rounded-lg bg-(--bg-sunken) px-3 py-2 text-xs font-black"
          >
            {labels.clients}
          </button>
        </div>
      )}
      {/* Selected client: report the shop closed (photo required) right here. */}
      {effClient && (
        <div className="space-y-1.5">
          {closedState.ids.has(effClient.id) && (
            <p className="rounded-xl bg-red-600/10 p-2.5 text-xs font-black text-red-600">🔒 {labels.closedBadge}</p>
          )}
          <ClosedShopButton
            client={{ id: effClient.id, name: effClient.name, code: effClient.code }}
            closed={closedState.ids.has(effClient.id)}
            canReport={jstate === "active" || role === "Admin"}
            labels={labels}
            onSaved={(id) => closedState.add(id)}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2 text-center sm:p-3">
          <ReceiptText size={16} className="mx-auto text-(--brand-600) sm:size-[18px]" />
          <div className="mt-0.5 text-lg font-black tabular-nums sm:mt-1 sm:text-xl">{dayCount}</div>
        </div>
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2 text-center sm:p-3">
          <Wallet size={16} className="mx-auto text-(--brand-600) sm:size-[18px]" />
          <div className="mt-0.5 truncate text-lg font-black tabular-nums sm:mt-1 sm:text-xl" dir="ltr">{dzMoney(dayTotal)}</div>
        </div>
      </div>

      {tournee && tournee.status === "OPEN" ? (
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-bold opacity-60">
            <span>{labels.startDay}</span>
            {/* Hydration-safe: time text renders only after mount — the
                server timezone and the phone timezone would print different
                strings for the same instant (React #418). */}
            <span className="tabular-nums" dir="ltr">
              {mounted && stamp?.startedAt ? new Date(stamp.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—"}
              {dayPending && !stamp?.startedAt ? ` ⏳` : ""}
            </span>
          </div>
          <div className="mb-2 flex items-center justify-between text-xs font-bold opacity-60">
            <span>{labels.finishDay}</span>
            <span className="tabular-nums" dir="ltr">
              {mounted && stamp?.finishedAt ? new Date(stamp.finishedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—"}
              {dayPending && stamp?.startedAt && !stamp?.finishedAt ? ` ⏳` : ""}
            </span>
          </div>
          {stamp?.startedAt && mounted && (() => {
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
              <Button onClick={() => void openFinish()} disabled={stamping} variant="secondary" className="h-12 flex-1 text-base">
                {labels.finishDay}
              </Button>
            ) : null}
          </div>
          {dayPending && (
            <p className="mt-2 rounded-xl bg-amber-500/10 p-2 text-xs font-bold text-amber-600">{labels.dayQueued ?? ""}</p>
          )}
          {(dayAuto || tournee?.autoClosed || (pastEnd && !stampRaw?.finishedAt)) && (
            <p className="mt-2 rounded-xl bg-red-500/10 p-2 text-xs font-bold text-red-500">⚠ {labels.autoClosedDay ?? ""}</p>
          )}
          {dayError && (
            <p className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500"><ErrText code={dayError} /></p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-(--border-default) p-3 text-center text-xs font-bold opacity-60">
          {labels.noTournee ?? ""}
        </div>
      )}

      {/* Responsive tile density: 3 columns on phones so the whole set
          fits near one view, 4 on large phones/tablets, 5 on desktop.
          Tiles stay ≥76px tall (comfortable touch target) with truncated
          labels — nothing overflows or cuts off on narrow screens. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        {visibleTiles.map(({ key, label, badge, Icon, cls, go }) => {
          const locked = lockedKeys.includes(key);
          return (
          <button
            key={key}
            onClick={locked ? () => setDayError("tour_not_started") : go}
            aria-disabled={locked}
            className={cn("relative flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2 shadow-sm transition-all active:scale-[0.98] sm:min-h-20 sm:gap-1.5 sm:p-3", locked && "opacity-45")}
          >
            {(badge ?? 0) > 0 && (
              <span className="absolute end-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-(--brand-500) px-1 text-[10px] font-black text-(--brand-contrast) tabular-nums sm:end-2 sm:top-2 sm:h-6 sm:min-w-6 sm:text-[11px]">
                {badge}
              </span>
            )}
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl sm:h-11 sm:w-11", cls)}>
              <Icon size={18} className="sm:hidden" />
              <Icon size={20} className="hidden sm:block" />
            </span>
            <span className="w-full truncate px-0.5 text-center text-[11px] font-black sm:text-[13px]">{label}</span>
            {locked && <Lock size={12} className="absolute start-1.5 top-1.5 opacity-70" />}
          </button>
          );
        })}
        <button
          onClick={() => setSyncOpen(true)}
          className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-2 shadow-sm transition-all active:scale-[0.98] sm:min-h-20 sm:gap-1.5 sm:p-3"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 sm:h-11 sm:w-11">
            <RefreshCw size={18} className="sm:hidden" />
            <RefreshCw size={20} className="hidden sm:block" />
          </span>
          <span className="w-full truncate px-0.5 text-center text-[11px] font-black sm:text-[13px]">{labels.syncT}{pending > 0 ? ` (${pending})` : ""}</span>
          <span className="w-full truncate px-0.5 text-center text-[9px] opacity-50 sm:text-[10px]">
            {lastSync ? `${labels.lastSync}: ${new Date(lastSync).toLocaleTimeString(`${locale}-u-nu-latn`)}` : labels.pending}
          </span>
        </button>
      </div>

      <ApkOnly><SyncModal
        open={syncOpen}
        offlinePages={{ locale, day, role }}
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
          offlineReady: labels.syncOfflineReady, offlineNotReady: labels.syncOfflineNotReady,
          webUpdateTitle: labels.syncWebUpdateTitle, webLater: labels.syncWebLater, webValidate: labels.syncWebValidate,
          nativeTitle: labels.syncNativeTitle, nativeGo: labels.syncNativeGo,
          history: labels.syncHistory, noHistory: labels.syncNoHistory, clearHistory: labels.syncClearHistory,
          camNeedHttps: labels.syncCamNeedHttps, camDenied: labels.syncCamDenied, camUnsupported: labels.syncCamUnsupported,
          directSync: labels.syncDirectSync, noVan: labels.syncNoVan,
          updateTitle: labels.syncUpdateTitle, checkUpdate: labels.syncCheckUpdate,
          webOk: labels.syncWebOk, webNew: labels.syncWebNew, updateNow: labels.syncUpdateNow,
          downloadApk: labels.syncDownloadApk, apkHint: labels.syncApkHint,
          clockSkew: labels.syncClockSkew, pages: labels.warmPages,
        }}
      /></ApkOnly>

      {/* First-login warmup: fresh phones cache the whole driver app
          (sync + every screen verified) once, then vanish. Re-arms until
          a full run succeeds — dismiss only postpones. */}
      <ApkOnly><FirstRunWarmup
        locale={locale}
        day={day}
        role={role}
        onOpenSync={() => setSyncOpen(true)}
        labels={{
          title: labels.warmTitle, hint: labels.warmHint,
          stepSync: labels.warmSync, stepPages: labels.warmPages, stepMedia: labels.warmMedia,
          done: labels.warmDone, doneHint: labels.warmDoneHint,
          pairNeeded: labels.warmPairNeeded, pairHint: labels.warmPairHint,
          openSync: labels.warmOpenSync, retry: labels.warmRetry,
        }}
      /></ApkOnly>

      {/* Fin de journée recap: what the day produced, before locking it.
          Warns on undeclared till / unsynced ops — never blocks. */}
      <Modal open={finishOpen} onClose={() => setFinishOpen(false)} title={labels.finishDay} subtitle={vanName} icon="🏁" width="sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
            <span className="opacity-60">{labels.recapSales ?? ""}</span>
            <span className="tabular-nums" dir="ltr">{dayCount} · {dzMoney(dayTotal)}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-(--bg-sunken) px-3 py-2 text-sm font-bold">
            <span className="opacity-60">{labels.recapDue ?? ""}</span>
            <span className="tabular-nums" dir="ltr">{dzMoney(dueCash)}</span>
          </div>
          <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm font-bold ${declared == null ? "bg-amber-500/10 text-amber-600" : "bg-(--bg-sunken)"}`}>
            <span className="opacity-80">{labels.recapDeclared ?? ""}</span>
            <span className="tabular-nums" dir="ltr">{declared == null ? (labels.recapNotDeclared ?? "!") : dzMoney(declared)}</span>
          </div>
          {declared == null && (
            <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">{labels.recapNotDeclared ?? ""}</p>
          )}
          {pending > 0 && (
            <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">
              {labels.recapPending ?? ""} ({pending})
            </p>
          )}
          {dayError && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={dayError} /></p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setFinishOpen(false)} className="flex-1" disabled={stamping}>
              {labels.cancel}
            </Button>
            <Button onClick={() => void stampDay("finish")} disabled={stamping} className="flex-[2]">
              {stamping ? "…" : labels.finishDay}
            </Button>
          </div>
        </div>
      </Modal>

      {/* تسليم الصندوق: counted till → DECLARED (online, else queued). */}
      <Modal open={tillOpen} onClose={() => setTillOpen(false)} title={labels.declare} subtitle={vanName} icon="💵" width="sm">
        <div className="space-y-3">
          {Number.isFinite(dueCash) && dueCash > 0 && (
            <p className="rounded-xl bg-(--bg-sunken) p-2.5 text-xs font-bold opacity-80" dir="auto">
              {labels.dueHint ?? ""} <bdi className="tabular-nums">{dzMoney(dueCash)}</bdi>
            </p>
          )}
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
