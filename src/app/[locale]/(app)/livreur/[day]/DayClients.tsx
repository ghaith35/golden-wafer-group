"use client";

import { useEffect, useState } from "react";
import { ApkOnly } from "@/components/layout/ApkOnly";
import { useRouter } from "next/navigation";
import { ArrowLeft, Banknote, Clock, Crosshair, MapPin, Navigation, Phone, QrCode, UserPlus } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { LegacyClientQrField } from "@/components/scan/LegacyClientQrField";
import { ErrText } from "@/components/ui/ErrText";
import { UnsyncedBadge } from "@/components/sync/UnsyncedBadge";
import { useSavedDistances } from "@/lib/geo";
import { getPendingClients, goPage, queueOp, syncNow, warmJourneePages, getVanSnapshot, getOutbox, updateOutboxPayload, saleErrText, queueErrText } from "@/lib/sync/client";
import { checkOfflineClientUpdate } from "@/lib/sync/offline-rules";
import { OnlineBadge } from "@/components/sync/OnlineBadge";
import { clientQrPayload } from "@/lib/clients/validation";
import { dzMoney } from "@/lib/format";
import { canSell } from "@/lib/staff-permissions";
import { NewClient } from "./clients/new/NewClient";
import type { AreaScope } from "@/lib/users/area-scope";
import { cn } from "@/lib/utils";
import { ClientName } from "@/components/clients/ClientName";
import { proximityOf, PROX_CARD } from "@/lib/proximity";
import { haversineM } from "@/lib/geo-math";
import { RefreshButton } from "@/components/livreur/RefreshButton";
import { matchClient } from "@/lib/clients/display";

type Client = {
  id: string; name: string; code: string; phone: string | null;
  tierId: string | null; balance: unknown; legacyQr?: string | null;
  gpsLat: number | null; gpsLng: number | null;
  secteurId?: string | null;
  days: string[];
};

/// Step 2 — this day's clients only (the day's tour stops + its sector). Back goes to the journée start page (clock) — never
/// out of the journée flow.
export function DayClients({
  locale,
  day,
  vanName,
  hasTournee,
  hasStarted,
  tours = [],
  tourId = null,
  tourSecteurId = null,
  days,
  sectorName,
  clients,
  companyId,
  refs,
  role,
  areaScope,
  labels,
}: {
  locale: string;
  day: string;
  vanName: string;
  hasTournee: boolean;
  hasStarted: boolean;
  /// Every tour of the day (a van can run two): chips switch between them.
  tours?: Array<{ id: string; secteurName: string | null; stopsCount: number; running: boolean; done: boolean }>;
  tourId?: string | null;
  /// Sector of the selected tour — preselected in the new-client form.
  tourSecteurId?: string | null;
  days: string[];
  /// Sector of this day's tour (null = none set).
  sectorName?: string | null;
  clients: Client[];
  companyId: string;
  refs: {
    wilayas: Array<{ code: number; nameAr: string; nameFr: string }>;
    secteurs: Array<{ id: string; name: string; wilayaCode: number }>;
    tiers: Array<{ id: string; name: string }>;
  };
  role: string;
  /// Admin-assigned zones for new clients (null = everything).
  areaScope?: AreaScope | null;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  /// "" = all clients; otherwise one day slug.
  const [dayFilter, setDayFilter] = useState("");
  /// "" = every sector; otherwise one secteur id (chips above the list).
  const [secFilter, setSecFilter] = useState("");
  /// Maps links need connection — hidden offline instead of dead-ending.
  /// Default online so server and client render the same (synced on mount).
  const [online, setOnline] = useState(true);
  useEffect(() => {
    try {
      setOnline(navigator.onLine);
    } catch { /* assume online */ }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  /// Client detail card (tap a row): QR + phone + GPS + balance, all
  /// on-device — works fully offline. Selling goes through the card.
  const [detailFor, setDetailFor] = useState<Client | null>(null);
  const [qrImg, setQrImg] = useState("");
  /// Debt collection (versement) state — reset per client.
  const [collectAmt, setCollectAmt] = useState("");
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  useEffect(() => {
    setCollectAmt("");
    setCollectMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailFor?.id]);
  /// Staff are 403 on /api/versements, so collection is QUEUE-ONLY by
  /// design — which is also what makes it work fully offline (engine
  /// resolves pending: client ids + attributes the till server-side).
  /// Online, flush immediately so the debt drops in seconds.
  async function doCollect() {
    if (!detailFor || collectBusy) return;
    const amount = Number(collectAmt);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setCollectBusy(true);
    setCollectMsg(null);
    try {
      await queueOp("versement", {
        kind: "CLIENT_PAYMENT",
        clientId: detailFor.id,
        amount,
        date: day,
      });
      setCollectAmt("");
      setCollectMsg(labels.queuedOk ?? "queued");
      try {
        if (typeof navigator === "undefined" || navigator.onLine !== false) {
          await syncNow();
        }
      } catch {
        /* stays queued for the next sync */
      }
    } catch {
      setCollectMsg(labels.errSaveFailed ?? "save failed");
    } finally {
      setCollectBusy(false);
    }
  }

  /// Pending client updates (this phone, not yet synced): merged over SSR
  /// rows + detail so an offline edit is visible immediately, everywhere.
  const [upd, setUpd] = useState<Record<string, Record<string, unknown>>>({});
  async function reloadUpd() {
    try {
      const ops = await getOutbox();
      const m: Record<string, Record<string, unknown>> = {};
      for (const o of ops) {
        // Failed ops are excluded: their values aren't server truth (the
        // SyncModal surfaces them for repair/discard instead).
        if (o.kind !== "client-update" || !o.payload || o.error) continue;
        const p = o.payload as Record<string, unknown>;
        const cid = typeof p.clientId === "string" ? p.clientId : null;
        if (cid) m[cid] = { ...(m[cid] ?? {}), ...((p.patch ?? {}) as Record<string, unknown>) };
      }
      setUpd(m);
    } catch {
      /* ignore */
    }
  }
  /// Edit-client form state (inside the detail card, both roles).
  const [editOpen, setEditOpen] = useState(false);
  const [legacyQr, setLegacyQr] = useState<string | null>();
  const [legacyQrEdit, setLegacyQrEdit] = useState<string | null>();
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fActivity, setFActivity] = useState("");
  const [fWilaya, setFWilaya] = useState("");
  const [fSecteur, setFSecteur] = useState("");
  /// GPS fix captured in the edit form (null = keep the card's position).
  const [fGps, setFGps] = useState<{ lat: number; lng: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  useEffect(() => {
    setEditOpen(false);
    setEditMsg(null);
    setEditErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailFor?.id]);
  /// Open the edit form: prefill from the card + snapshot, then refresh
  /// from the server when online (full row incl. secteur/activity).
  async function openEdit() {
    if (!detailFor) return;
    const c = detailFor;
    setLegacyQr(c.legacyQr);
    setLegacyQrEdit(undefined);
    setFName(c.name ?? "");
    setFPhone(c.phone ?? "");
    setFAddress("");
    setFActivity("");
    setFWilaya("");
    setFSecteur("");
    setFGps(c.gpsLat != null && c.gpsLng != null ? { lat: c.gpsLat, lng: c.gpsLng } : null);
    setEditMsg(null);
    setEditErr(null);
    setEditOpen(true);
    try {
      if (c.id.startsWith("pending:")) {
        const pend = await getPendingClients().catch(() => []);
        const hit = pend.find((p) => `pending:${p.opId}` === c.id);
        if (hit) {
          const q = (hit as unknown as Record<string, unknown>);
          setFAddress(String(q.address ?? ""));
          setFActivity(String(q.activityType ?? ""));
          const w = q.wilayaCode;
          if (typeof w === "number") setFWilaya(String(w));
        }
        const ops = await getOutbox().catch(() => []);
        const last = [...ops].reverse().find((o) => o.kind === "client-update" && (o.payload as Record<string, unknown>)?.clientId === c.id);
        const patch = (last?.payload as Record<string, unknown> | undefined)?.patch as Record<string, unknown> | undefined;
        if (patch) {
          if (typeof patch.legacyQr === "string" || patch.legacyQr === null) setLegacyQr(patch.legacyQr);
          if (typeof patch.name === "string") setFName(patch.name);
          if (typeof patch.phone === "string") setFPhone(patch.phone);
          if (typeof patch.address === "string") setFAddress(patch.address);
          if (typeof patch.activityType === "string") setFActivity(patch.activityType);
          if (typeof patch.wilayaCode === "number") setFWilaya(String(patch.wilayaCode));
          if (typeof patch.secteurId === "string") setFSecteur(patch.secteurId);
          if (typeof patch.gpsLat === "number" && typeof patch.gpsLng === "number") {
            setFGps({ lat: patch.gpsLat, lng: patch.gpsLng });
          }
        }
        return;
      }
      const snap = await getVanSnapshot().catch(() => null);
      const sc = (snap?.clients ?? []).find((x) => x.id === c.id) as
        | { address?: string | null; wilayaCode?: number | null; legacyQr?: string | null }
        | undefined;
      if (sc) {
        if (c.legacyQr === undefined) setLegacyQr(sc.legacyQr);
        if (sc.address) setFAddress(sc.address);
        if (sc.wilayaCode != null) setFWilaya(String(sc.wilayaCode));
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const res = await fetch(`/api/clients/${c.id}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json().catch(() => null);
        if (d) {
          if (typeof d.legacyQr === "string" || d.legacyQr === null) setLegacyQr(d.legacyQr);
          if (typeof d.address === "string") setFAddress(d.address);
          if (typeof d.activityType === "string") setFActivity(d.activityType);
          if (d.wilayaCode != null) setFWilaya(String(d.wilayaCode));
          if (typeof d.secteurId === "string") setFSecteur(d.secteurId);
        }
      }
    } catch {
      /* prefill stands */
    }
  }
  /// One-shot GPS capture for the edit form (never blocks: 8s timeout,
  /// denied/unavailable leaves the form untouched).
  function captureGps() {
    if (capturing) return;
    try {
      if (!("geolocation" in navigator)) return;
    } catch {
      return;
    }
    setCapturing(true);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setFGps({ lat: p.coords.latitude, lng: p.coords.longitude });
          setCapturing(false);
        },
        () => setCapturing(false),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    } catch {
      setCapturing(false);
    }
  }
  /// Save the edit: PATCH online, queue `client-update` offline, rewrite
  /// the queued create for own pending clients. Financial fields are never
  /// sent (engine whitelists driver-safe fields either way).
  async function doEdit() {
    if (!detailFor || editBusy) return;
    const c = detailFor;
    // Send-only-what-changed, and never wipe a field we never loaded:
    // address/activity/wilaya/secteur go out only when the driver set them.
    const patch: Record<string, unknown> = {};
    if (legacyQrEdit !== undefined && legacyQrEdit !== legacyQr) patch.legacyQr = legacyQrEdit;
    if (fName.trim() && fName.trim() !== c.name) patch.name = fName.trim();
    if (fPhone.trim() !== (c.phone ?? "")) patch.phone = fPhone.trim() || null;
    if (fAddress.trim()) patch.address = fAddress.trim();
    if (fActivity.trim()) patch.activityType = fActivity.trim();
    if (fWilaya) patch.wilayaCode = Number(fWilaya);
    if (fSecteur) patch.secteurId = fSecteur;
    // GPS captured in the form: driver-safe field, queued offline like the
    // rest and whitelisted by the engine either way. Sent only when it
    // differs from the card (no-op saves stay empty).
    if (fGps && Number.isFinite(fGps.lat) && Number.isFinite(fGps.lng)) {
      const la = Math.round(fGps.lat * 1e6) / 1e6;
      const ln = Math.round(fGps.lng * 1e6) / 1e6;
      if (la !== c.gpsLat || ln !== c.gpsLng) {
        patch.gpsLat = la;
        patch.gpsLng = ln;
      }
    }
    if (Object.keys(patch).length === 0) {
      setEditOpen(false);
      return;
    }
    // Phone rules mirrored locally so a bad number fails fast, offline too.
    try {
      const [s, o] = await Promise.all([
        getVanSnapshot().catch(() => null),
        getOutbox().catch(() => []),
      ]);
      if (!online && patch.legacyQr && s?.clients.some((client) => client.id !== c.id && client.legacyQr === patch.legacyQr)) {
        setEditErr("duplicate_legacy_qr");
        return;
      }
      const check = checkOfflineClientUpdate(s, o, c.id, {
        phone: typeof patch.phone === "string" ? patch.phone : (c.phone ?? ""),
      });
      if (!check.ok) {
        setEditErr(saleErrText(labels, check.error) ?? check.error);
        return;
      }
    } catch {
      /* no snapshot yet → the server decides */
    }
    setEditBusy(true);
    setEditErr(null);
    setEditMsg(null);
    try {
      if (c.id.startsWith("pending:")) {
        const opId = c.id.slice("pending:".length);
        const ops = await getOutbox();
        const row = ops.find((o) => o.opId === opId && o.kind === "client");
        if (!row) throw new Error("gone");
        const { legacyQr, ...details } = patch;
        if (Object.keys(details).length) {
          await updateOutboxPayload(opId, { ...(row.payload as Record<string, unknown>), ...details });
        }
        if (legacyQr !== undefined) await queueOp("client-update", { clientId: c.id, patch: { legacyQr } });
        setEditOpen(false);
        setEditMsg(legacyQr !== undefined ? (labels.queuedOk ?? "saved for sync") : (labels.clientUpdated ?? "updated ✓"));
        await reloadPending();
        await reloadUpd();
        setDetailFor((prev) => (prev ? { ...prev, ...(patch as Partial<Client>) } : prev));
        return;
      }
      let queued = false;
      try {
        const res = await fetch(`/api/clients/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(patch),
        });
        if (res.status >= 500) throw new Error("server_unreachable");
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          setEditErr(saleErrText(labels, String(d?.error ?? "failed")) ?? "failed");
          return;
        }
      } catch {
        // Offline (or dropped): queue the update, it applies at sync.
        await queueOp("client-update", { clientId: c.id, patch });
        queued = true;
        await reloadUpd();
      }
      setEditOpen(false);
      setEditMsg(queued && patch.legacyQr !== undefined ? (labels.queuedOk ?? "saved for sync") : (labels.clientUpdated ?? "updated ✓"));
      setUpd((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] ?? {}), ...patch } }));
      setDetailFor((prev) => (prev ? { ...prev, ...(patch as Partial<Client>) } : prev));
      try {
        if (typeof navigator === "undefined" || navigator.onLine !== false) {
          await syncNow();
          await reloadUpd();
        }
      } catch {
        /* stays queued for the next sync */
      }
    } catch (e) {
      setEditErr(queueErrText(labels, e));
    } finally {
      setEditBusy(false);
    }
  }
  async function showDetail(c: Client) {
    // Merge this phone's pending edits so the card shows the latest values.
    const u = upd[c.id];
    setDetailFor(u ? { ...c, ...(u as Partial<Client>) } : c);
    setQrImg("");
    try {
      setQrImg(await QRCode.toDataURL(clientQrPayload(companyId, c.code), { margin: 1, width: 320 }));
    } catch {
      setQrImg("");
    }
  }

  const detailTier = detailFor?.tierId ? refs.tiers.find((t) => t.id === detailFor.tierId)?.name ?? null : null;
  const { locating, geoError, locate, meta, pos, raw } = useSavedDistances({
    unitM: labels.unitM, unitKm: labels.unitKm, unitMin: labels.unitMin,
  });

  // Auto-actualise on entry + warm the journée pages while online.
  // Merge this phone's not-yet-synced clients so the driver sees and can
  // sell to them immediately (⏳ until the sync confirms them).
  const [pending, setPending] = useState<Client[]>([]);
  /// Live position for the proximity colours: a fresh phone fix every 5 s
  /// (local only — the saved road distances are not recomputed each tick).
  const [livePos, setLivePos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (stop || busy || document.hidden) return;
      busy = true;
      try {
        const m = await import("@/lib/van-gps");
        const f = await m.getGpsFix(0);
        if (!stop && f) setLivePos({ lat: f.lat, lng: f.lng });
      } catch {
        /* keep the last position */
      }
      busy = false;
    };
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);
  /// New-client popup (form embedded, no page navigation).
  const [adding, setAdding] = useState(false);
  async function reloadPending() {
    try {
      const ps = await getPendingClients();
      setPending(
        ps.map((p) => ({
          id: `pending:${p.opId}`, name: p.name, code: p.code,
          phone: p.phone, tierId: p.tierId, balance: 0,
          gpsLat: null, gpsLng: null, days: [] as string[],
        }))
      );
    } catch { /* ignore */ }
  }
  useEffect(() => {
    locate();
    warmJourneePages(locale, day);
    void reloadUpd();
    getPendingClients()
      .then((ps) =>
        setPending(
          ps.map((p) => ({
            id: `pending:${p.opId}`, name: p.name, code: p.code,
            phone: p.phone, tierId: p.tierId, balance: 0,
            gpsLat: null, gpsLng: null, days: [] as string[],
          }))
        )
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!adding) void reloadPending();
  }, [adding]);

  const shortDay = (slug: string) => {
    const [y, m, d] = slug.split("-").map(Number);
    if (!y || !m || !d) return slug;
    return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "numeric" });
  };

  /// SSR rows with this phone's pending edits merged in (same map as the
  /// detail card, so list and card always agree).
  const effClients = clients.map((c) => (upd[c.id] ? { ...c, ...(upd[c.id] as Partial<Client>) } : c));
  const allRows = [...effClients, ...pending.filter((p) => !clients.some((c) => c.code === p.code))];
  const secOf = (c: unknown) => (c as { secteurId?: string | null }).secteurId ?? "";
  const secName = (id: string) => refs.secteurs.find((s) => s.id === id)?.name ?? "—";
  /// Sectors present in the day's clients, biggest first, with their counts.
  const secCounts = new Map<string, number>();
  for (const c of allRows) secCounts.set(secOf(c), (secCounts.get(secOf(c)) ?? 0) + 1);
  const secChips = [...secCounts.entries()].sort((a, b) => b[1] - a[1]);
  const list = allRows.filter(
    (c) =>
      (!dayFilter || (c.days ?? []).includes(dayFilter)) &&
      (!secFilter || secOf(c) === secFilter) &&
      (!q || matchClient(q, c))
  );
  /// One block per sector (header shown only when the list mixes sectors).
  const groups = new Map<string, typeof list>();
  for (const c of list) {
    const k = secOf(c);
    const g = groups.get(k);
    if (g) g.push(c); else groups.set(k, [c]);
  }
  const showHeaders = groups.size > 1;

  const mapsUrl = (c: Client) => {
    if (c.gpsLat == null || c.gpsLng == null) return null;
    const dest = `${c.gpsLat},${c.gpsLng}`;
    // With live position: Maps shows route + live traffic ETA.
    return pos
      ? `https://www.google.com/maps/dir/?api=1&origin=${pos.lat},${pos.lng}&destination=${dest}&travelmode=driving`
      : `https://www.google.com/maps?q=${dest}`;
  };

  return (
    <div className="space-y-3 p-4 pb-28 md:p-5 md:pb-28">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => goPage(router, hasStarted ? `/${locale}/livreur/${day}/dashboard` : `/${locale}/livreur/${day}/start`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.clients} ({list.length})</h1>
          <p className="truncate text-xs opacity-60">{vanName}{sectorName ? ` · ${sectorName}` : ""}</p>
        </div>
        <ApkOnly><OnlineBadge onlineLabel={labels.online ?? "online"} offlineLabel={labels.offline ?? "offline"} /></ApkOnly>
        {!hasStarted && (
          <button
            onClick={() => goPage(router, `/${locale}/livreur/${day}/start`)}
            title={labels.startDay}
            aria-label={labels.startDay}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
          >
            <Clock size={17} />
          </button>
        )}
        <button
          onClick={() => locate()}
          disabled={locating}
          title={labels.actualiser}
          aria-label={labels.actualiser}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <Crosshair size={16} className={cn(locating && "animate-spin")} />
        </button>
        <RefreshButton label={labels.actualiser ?? "refresh"} onLocal={() => locate()} />
        <button
          type="button"
          onClick={() => setAdding(true)}
          title={labels.newClient}
          aria-label={labels.newClient}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500) text-(--brand-contrast)"
        >
          <UserPlus size={17} />
        </button>
      </div>
      {geoError && <p className="rounded-xl bg-red-500/10 p-2 text-xs font-bold text-red-500">{labels.geoDenied}</p>}

      {!hasTournee && (
        <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">{labels.noTournee}</p>
      )}

      {tours.length >= 2 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={labels.tourOf}>
          {tours.map((tr, i) => {
            const on = tr.id === tourId;
            return (
              <button
                key={tr.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => !on && goPage(router, `/${locale}/livreur/${day}?tour=${tr.id}`)}
                className={cn(
                  "flex h-12 shrink-0 items-center gap-2 rounded-2xl px-3.5 text-sm font-black transition-all active:scale-95",
                  on ? "bg-gradient-brand text-(--brand-contrast) shadow" : "border border-(--border-default) bg-(--bg-overlay)"
                )}
              >
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-xs", on ? "bg-white/25" : "bg-(--bg-sunken)")}>{String.fromCharCode(65 + i)}</span>
                <span className="max-w-[9rem] truncate">{tr.secteurName ?? `#${i + 1}`}</span>
                <span className="tabular-nums opacity-70">({tr.stopsCount})</span>
                {tr.running && <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />}
                {tr.done && <span aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="sticky top-0 space-y-2">
        {days.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1" dir="ltr">
            <button
              type="button"
              onClick={() => setDayFilter("")}
              className={cn(
                "h-9 shrink-0 rounded-full px-3.5 text-xs font-black transition-colors",
                dayFilter === ""
                  ? "bg-gradient-brand text-(--brand-contrast) shadow"
                  : "border border-(--border-default) bg-(--bg-overlay)"
              )}
            >
              {labels.all ?? "all"} ({clients.length})
            </button>
            {days.map((s) => {
              const n = clients.filter((c) => (c.days ?? []).includes(s)).length;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDayFilter(dayFilter === s ? "" : s)}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-3.5 text-xs font-black tabular-nums transition-colors",
                    dayFilter === s
                      ? "bg-gradient-brand text-(--brand-contrast) shadow"
                      : "border border-(--border-default) bg-(--bg-overlay)"
                  )}
                >
                  {shortDay(s)} ({n})
                </button>
              );
            })}
          </div>
        )}
        {secChips.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
            {[["", allRows.length] as [string, number], ...secChips].map(([id, n]) => (
              <button
                key={id || "all"}
                type="button"
                role="tab"
                aria-selected={secFilter === id}
                onClick={() => setSecFilter(id)}
                className={cn(
                  "h-9 shrink-0 rounded-full px-3.5 text-xs font-black transition-colors",
                  secFilter === id ? "bg-(--brand-500) text-(--brand-contrast)" : "bg-(--bg-sunken) text-(--text-secondary)"
                )}
              >
                <span className="max-w-[10rem] truncate">{id === "" ? labels.all : secName(id)}</span>
                <span className="ms-1 tabular-nums opacity-70">({n})</span>
              </button>
            ))}
          </div>
        )}
        <Input placeholder={labels.searchClient} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        {[...groups.entries()].map(([gk, rows]) => (
          <div key={gk || "none"} className="space-y-1.5">
            {showHeaders && (
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-(--bg-page)/95 px-1 pt-2 text-[11px] font-black text-(--text-secondary) backdrop-blur">
                <span className="truncate">{secName(gk)}</span>
                <span className="tabular-nums opacity-60">({rows.length})</span>
                <span className="h-px flex-1 bg-(--border-default)" />
              </div>
            )}
        {rows.map((c) => {
          const dist = meta(c.id);
          const url = mapsUrl(c);
          // Green close · orange far · red very far (straight-line from the
          // phone's own fix — works offline). No GPS on the client = neutral.
          // Live fix first (works offline); until it lands, the saved distance
          // shown on the card drives the colour so list and colour always agree.
          const here = livePos ?? pos;
          const prox = proximityOf(
            here && c.gpsLat != null && c.gpsLng != null
              ? haversineM(here.lat, here.lng, Number(c.gpsLat), Number(c.gpsLng))
              : raw.get(c.id)?.distM ?? null
          );
          return (
            <div
              key={c.id}
              className={cn("flex w-full items-center gap-2.5 rounded-2xl border p-3", PROX_CARD[prox])}
            >
              <button
                onClick={() => void showDetail(c)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-base font-black">
                  {c.name.trim().charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center text-sm font-black">
                    <ClientName name={c.name} map={false} />
                    {c.id.startsWith("pending:") && <UnsyncedBadge className="ms-1 px-1.5" />}
                  </span>
                  <span className="block truncate font-mono text-[11px] opacity-50" dir="ltr">{c.code}</span>
                  {dist && <span className="block truncate text-[11px] font-bold text-(--brand-600)">{dist}</span>}
                </span>
              </button>
              {c.phone && !c.id.startsWith("pending:") ? (
                <a
                  href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                  aria-label={labels.callClient ?? "call"}
                  title={labels.callClient ?? "call"}
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"
                >
                  <Phone size={17} />
                </a>
              ) : null}
              {url && online ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GPS"
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600)"
                >
                  <Navigation size={17} />
                </a>
              ) : (
                <span className="shrink-0 font-black opacity-40">‹</span>
              )}
            </div>
          );
        })}
          </div>
        ))}
        {list.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>

      <button
        onClick={() => goPage(router, `/${locale}/livreur/${day}/dashboard`)}
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-2 border-t border-(--border-default) bg-(--bg-overlay) py-3.5 text-base font-black lg:bottom-0"
      >
        {labels.skip} →
      </button>

      {/* New client — popup form, no page navigation. */}
      <Modal open={adding} onClose={() => setAdding(false)} title={labels.newClient ?? ""} icon={<UserPlus size={18} />} width="sm">
        <NewClient
          locale={locale}
          day={day}
          companyId={companyId}
          wilayas={refs.wilayas}
          secteurs={refs.secteurs}
          tiers={refs.tiers}
          labels={labels}
          areaScope={areaScope}
          defaultSecteurId={tourSecteurId}
          embedded
          onCreated={() => void reloadPending()}
          onClose={() => setAdding(false)}
        />
      </Modal>

      {/* Client detail card — QR + phone + GPS + balance, all on-device. */}
      <Modal open={detailFor !== null} onClose={() => { setDetailFor(null); setQrImg(""); }} title={detailFor?.name ?? ""} subtitle={detailFor?.code ?? ""} icon={<QrCode size={18} />}>
        {detailFor && (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-1">
              {qrImg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrImg} alt={detailFor.code} className="h-48 w-48 rounded-xl bg-white p-2" />
              ) : (
                <p className="py-8 text-sm opacity-60">…</p>
              )}
              <p className="font-mono text-sm font-black tabular-nums" dir="ltr">
                {detailFor.code}
                {detailFor.id.startsWith("pending:") && <UnsyncedBadge className="ms-1 px-1.5" />}
              </p>
              {detailTier && (
                <p className="rounded-full bg-(--bg-sunken) px-3 py-1 text-xs font-black opacity-80">{detailTier}</p>
              )}
            </div>
            <div className="space-y-1.5">
              {detailFor.phone ? (
                <a
                  href={`tel:${detailFor.phone.replace(/[^+\d]/g, "")}`}
                  dir="ltr"
                  className="flex items-center gap-2.5 rounded-xl bg-(--bg-sunken) px-3 py-2.5 text-sm font-black"
                >
                  <Phone size={16} className="shrink-0 text-(--brand-600)" />
                  <bdi>{detailFor.phone}</bdi>
                </a>
              ) : null}
              <div className="flex items-center gap-2.5 rounded-xl bg-(--bg-sunken) px-3 py-2.5 text-sm font-black">
                <Banknote size={16} className="shrink-0 text-(--brand-600)" />
                <span dir="ltr">{dzMoney(Number(detailFor.balance ?? 0))}</span>
              </div>
              {/* تحصيل دين: queue-only (staff are 403 on /api/versements),
                  works fully offline, flushes immediately when online. */}
              <div className="rounded-xl border border-(--border-default) p-3">
                <div className="mb-2 text-sm font-black">{labels.collect ?? "Collect"}</div>
                <div className="flex gap-2">
                  <Input
                    type="number" min={0} step="any" value={collectAmt}
                    onChange={(e) => setCollectAmt(e.target.value)} dir="ltr"
                    inputMode="decimal" placeholder={labels.amount ?? ""}
                    className="text-center font-black tabular-nums"
                  />
                  <Button
                    onClick={() => void doCollect()}
                    disabled={collectBusy || !(Number(collectAmt) > 0)}
                    className="flex-1"
                  >
                    {collectBusy ? "…" : (labels.collect ?? "Collect")}
                  </Button>
                </div>
                {collectMsg && <p className="mt-2 rounded-xl bg-emerald-500/10 p-2 text-xs font-bold text-emerald-600">{collectMsg}</p>}
              </div>
              {detailFor.gpsLat != null && detailFor.gpsLng != null ? (
                <div className="flex items-center gap-2.5 rounded-xl bg-(--bg-sunken) px-3 py-2.5 text-sm font-bold">
                  <MapPin size={16} className="shrink-0 text-(--brand-600)" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums" dir="ltr">
                    {detailFor.gpsLat}, {detailFor.gpsLng}
                  </span>
                  {online && mapsUrl(detailFor) ? (
                    <a
                      href={mapsUrl(detailFor) as string}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="GPS"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--brand-500)/10 text-(--brand-600)"
                    >
                      <Navigation size={15} />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            {/* تعديل الزبون: works fully offline (PATCH online, queued
                client-update offline, queued-create rewrite for pending).
                Financial fields are never editable here — nor sent. */}
            {!editOpen ? (
              <Button variant="secondary" onClick={() => void openEdit()} className="h-12 w-full text-base">
                ✎ {labels.editClient ?? "Edit"}
              </Button>
            ) : (
              <div className="space-y-2 rounded-xl border border-(--border-default) p-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.clientName ?? ""}</label>
                  <Input value={fName} onChange={(e) => setFName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.phoneOpt}</label>
                    <Input value={fPhone} onChange={(e) => setFPhone(e.target.value)} dir="ltr" inputMode="tel" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.activityOpt}</label>
                    <Input value={fActivity} onChange={(e) => setFActivity(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.addressOpt}</label>
                  <Input value={fAddress} onChange={(e) => setFAddress(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.wilayaOpt}</label>
                    <select
                      value={fWilaya}
                      onChange={(e) => { setFWilaya(e.target.value); setFSecteur(""); }}
                      className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
                    >
                      <option value="">—</option>
                      {refs.wilayas.map((w) => (
                        <option key={w.code} value={w.code}>{w.code} · {locale === "ar" ? w.nameAr : w.nameFr}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.secteurOpt}</label>
                    <select
                      value={fSecteur}
                      onChange={(e) => setFSecteur(e.target.value)}
                      className="h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)"
                    >
                      <option value="">—</option>
                      {refs.secteurs.filter((s) => !fWilaya || String(s.wilayaCode) === fWilaya).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase opacity-60">GPS</label>
                  <button
                    type="button"
                    onClick={captureGps}
                    disabled={capturing}
                    className="flex h-11 w-full items-center gap-2 rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm font-bold outline-none focus:border-(--brand-500) disabled:opacity-60"
                  >
                    <MapPin size={15} className="shrink-0 text-(--brand-600)" />
                    <span className="min-w-0 flex-1 truncate text-start font-mono text-xs tabular-nums" dir="ltr">
                      {capturing ? "…" : fGps ? `${fGps.lat.toFixed(5)}, ${fGps.lng.toFixed(5)}` : (labels.useGps ?? "GPS")}
                    </span>
                    <Crosshair size={15} className={cn("shrink-0 opacity-60", capturing && "animate-spin")} />
                  </button>
                </div>
                <LegacyClientQrField
                  key={detailFor.id}
                  value={legacyQrEdit === undefined ? legacyQr : legacyQrEdit}
                  changed={legacyQrEdit !== undefined}
                  onChange={setLegacyQrEdit}
                  disabled={editBusy}
                />
                {editErr && <p className="rounded-lg bg-red-500/10 p-2 text-xs font-bold text-red-500"><ErrText code={editErr} /></p>}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditOpen(false)} className="flex-1" disabled={editBusy}>{labels.cancel}</Button>
                  <Button onClick={() => void doEdit()} disabled={editBusy} data-testid="save-client-edit" className="flex-[2]">
                    {editBusy ? "…" : (labels.confirm ?? "OK")}
                  </Button>
                </div>
              </div>
            )}
            {editMsg && <p className="rounded-xl bg-emerald-500/10 p-2 text-xs font-bold text-emerald-600">{editMsg}</p>}
            {canSell(role) && (
            <Button
              onClick={() => {
                const id = detailFor.id;
                setDetailFor(null);
                setQrImg("");
                goPage(router, `/${locale}/livreur/${day}/dashboard?client=${id}`);
              }}
              className="h-12 w-full text-base"
            >
              {labels.newSale}
            </Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
