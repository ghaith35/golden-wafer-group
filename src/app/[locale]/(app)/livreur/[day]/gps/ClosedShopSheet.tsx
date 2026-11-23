"use client";

import { useRef, useState } from "react";
import { Camera, Lock, Plus, X } from "lucide-react";
import { queueOp, syncNow } from "@/lib/sync/client";
import { compressToJpegDataUrl } from "@/lib/photo";
import { cn } from "@/lib/utils";

const MAX_PHOTOS = 6;

/// Bottom sheet for one client: "the shop is closed" → camera pops up → one or
/// several photos → saved on the phone (works offline) and sent to the admin at
/// the next sync. Nothing is sent until the driver taps the closed button.
export function ClosedShopSheet({
  client,
  pos,
  alreadyClosed,
  labels,
  onClose,
  onSaved,
}: {
  client: { id: string; name: string; code: string };
  pos: { lat: number; lng: number } | null;
  alreadyClosed: boolean;
  labels: Record<string, string>;
  onClose: () => void;
  onSaved: (clientId: string, queuedOffline: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openCamera = () => {
    setErr(null);
    fileRef.current?.click();
  };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // same photo can be picked again
    if (!f) return;
    setBusy(true);
    try {
      const url = await compressToJpegDataUrl(f);
      setPhotos((p) => [...p, url].slice(0, MAX_PHOTOS));
    } catch {
      setErr(labels.closedErr);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!photos.length || saving) return;
    setSaving(true);
    setErr(null);
    try {
      // Persisted in the phone's outbox first — a sync failure can never lose it.
      await queueOp("client-closed", { clientId: client.id, photos, lat: pos?.lat ?? null, lng: pos?.lng ?? null });
      const online = typeof navigator === "undefined" || navigator.onLine !== false;
      let sent = false;
      if (online) {
        try {
          await syncNow();
          sent = true;
        } catch {
          sent = false; // stays queued; next sync sends it
        }
      }
      onSaved(client.id, !sent);
      onClose();
    } catch {
      setErr(labels.closedErr);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-label={client.name}>
      <div className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-(--bg-surface) p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-black">{client.name}</h2>
            <p className="truncate font-mono text-xs opacity-60" dir="ltr">{client.code}</p>
          </div>
          <button type="button" aria-label="close" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)">
            <X size={18} />
          </button>
        </div>

        {alreadyClosed && (
          <p className="rounded-xl bg-amber-500/15 p-2.5 text-xs font-black text-amber-600">🔒 {labels.closedBadge}</p>
        )}

        {/* hidden camera input: opens the phone camera directly */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e)} />

        {photos.length === 0 ? (
          <button
            type="button"
            onClick={openCamera}
            disabled={busy}
            className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-red-600 text-lg font-black text-white shadow-lg active:scale-[0.98] disabled:opacity-60"
          >
            <Lock size={22} />
            {busy ? "…" : labels.closedShop}
          </button>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((src, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-xl border border-(--border-default)">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="remove"
                    onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    className="absolute end-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={openCamera}
                  disabled={busy}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-(--border-default) text-xs font-black disabled:opacity-60"
                >
                  {busy ? "…" : <><Plus size={20} /><Camera size={16} className="opacity-60" />{labels.closedAddPhoto}</>}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || busy}
              className={cn("flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand text-base font-black text-(--brand-contrast) shadow active:scale-[0.98]", (saving || busy) && "opacity-60")}
            >
              {saving ? "…" : `${labels.closedSave} (${photos.length})`}
            </button>
          </>
        )}
        <p className="text-center text-[11px] font-bold opacity-60">{labels.closedHint}</p>
        {err && <p className="rounded-xl bg-red-500/10 p-2.5 text-xs font-bold text-red-500">{err}</p>}
      </div>
    </div>
  );
}
