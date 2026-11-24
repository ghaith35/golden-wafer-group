"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Lock } from "lucide-react";
import { getOutbox } from "@/lib/sync/client";
import { cn } from "@/lib/utils";
import { ClosedShopSheet } from "@/app/[locale]/(app)/livreur/[day]/gps/ClosedShopSheet";

/// Clients reported closed TODAY: what the server already knows + reports still
/// waiting in this phone's outbox (offline), so the 🔒 badge is right instantly
/// and survives a reload even with no connection.
export function useClosedIds(initial: string[]) {
  // Server ids come in as a prop; this phone adds its own (outbox + just saved).
  const [extra, setExtra] = useState<string[]>([]);
  useEffect(() => {
    let dead = false;
    getOutbox()
      .then((ops) => {
        if (dead) return;
        const pend = ops
          .filter((o) => o.kind === "client-closed")
          .map((o) => String((o.payload as { clientId?: unknown }).clientId ?? ""))
          .filter(Boolean);
        if (pend.length) setExtra((e) => [...new Set([...e, ...pend])]);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);
  const key = initial.join(",") + "|" + extra.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => new Set([...initial, ...extra]), [key]);
  const add = (id: string) => setExtra((e) => (e.includes(id) ? e : [...e, id]));
  return { ids, add };
}

/// "Shop closed" for ONE client: the red button opens the camera sheet. A
/// closed report is only ever recorded WITH at least one photo (the sheet has
/// no save without it), is stamped with the phone's real time + GPS, queued on
/// the phone first (offline-safe) and then synced.
export function ClosedShopButton({
  client,
  closed,
  canReport,
  labels,
  onSaved,
  className,
}: {
  client: { id: string; name: string; code: string };
  /// Already reported closed today.
  closed: boolean;
  /// False until the journée is started (reports belong to the running journée).
  canReport: boolean;
  labels: Record<string, string>;
  onSaved: (clientId: string, queuedOffline: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // A pending (not yet synced) client has no server id: the sync engine resolves
  // "pending:<opId>" in the same batch, so it can be reported like any other.
  useEffect(() => {
    if (!open) return;
    let dead = false;
    import("@/lib/van-gps")
      .then((m) => m.getGpsFix(30000))
      .then((f) => {
        if (!dead && f) setPos({ lat: f.lat, lng: f.lng });
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        disabled={!canReport}
        onClick={() => setOpen(true)}
        data-testid="closed-shop-btn"
        className={cn(
          "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-black active:scale-[0.98] disabled:opacity-50",
          closed ? "border-2 border-red-600 bg-red-600/10 text-red-600" : "bg-red-600 text-white shadow",
          className,
        )}
      >
        <Lock size={18} />
        {closed ? `${labels.closedToday ?? labels.closedShop} · ${labels.closedAddPhoto}` : labels.closedShop}
      </button>
      {!canReport && <p className="text-center text-[11px] font-bold opacity-60">{labels.closedNeedStart}</p>}
      {/* Portaled to <body>: a popup inside another popup must not be clipped or
          re-anchored by the parent's transform/overflow. */}
      {open && createPortal(
        <ClosedShopSheet
          client={client}
          pos={pos}
          alreadyClosed={closed}
          labels={labels}
          onClose={() => setOpen(false)}
          onSaved={(id, offline) => {
            onSaved(id, offline);
            setToast(offline ? labels.closedSavedOffline : labels.closedSaved);
            window.setTimeout(() => setToast(null), 3500);
          }}
        />,
        document.body,
      )}
      {toast && createPortal(
        <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[95] rounded-2xl bg-emerald-600 p-3 text-center text-sm font-black text-white shadow-xl">{toast}</div>,
        document.body,
      )}
    </>
  );
}
