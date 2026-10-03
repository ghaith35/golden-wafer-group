"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Crosshair, Navigation } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { useSavedDistances } from "@/lib/geo";
import { cn } from "@/lib/utils";

type Client = {
  id: string; name: string; code: string; phone: string | null;
  gpsLat: number | null; gpsLng: number | null;
};

/// Step 2 — day clients with live GPS distances. Auto-locates on entry.
export function DayClients({
  locale,
  day,
  vanName,
  hasTournee,
  clients,
  labels,
}: {
  locale: string;
  day: string;
  vanName: string;
  hasTournee: boolean;
  clients: Client[];
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const { locating, geoError, locate, meta, pos } = useSavedDistances({
    unitM: labels.unitM, unitKm: labels.unitKm, unitMin: labels.unitMin,
  });

  // Auto-actualise on entry.
  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = q
    ? clients.filter((c) => c.name.includes(q) || c.code.includes(q))
    : clients;

  const mapsUrl = (c: Client) => {
    if (c.gpsLat == null || c.gpsLng == null) return null;
    const dest = `${c.gpsLat},${c.gpsLng}`;
    // With live position: Maps shows route + live traffic ETA.
    return pos
      ? `https://www.google.com/maps/dir/?api=1&origin=${pos.lat},${pos.lng}&destination=${dest}&travelmode=driving`
      : `https://www.google.com/maps?q=${dest}`;
  };

  return (
    <div className="space-y-3 p-4 pb-28 md:p-5">
      <div className="flex items-center gap-2">
        <button
          aria-label="back"
          onClick={() => router.push(`/${locale}/livreur`)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black">{labels.clients} ({clients.length})</h1>
          <p className="truncate text-xs opacity-60">{vanName}</p>
        </div>
        <button
          onClick={() => router.push(`/${locale}/livreur/${day}/start`)}
          title={labels.startDay}
          aria-label={labels.startDay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default)"
        >
          <Clock size={17} />
        </button>
        <button
          onClick={() => locate()}
          disabled={locating}
          title={labels.actualiser}
          aria-label={labels.actualiser}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-(--border-default) px-3 text-xs font-black"
        >
          <Crosshair size={15} className={cn(locating && "animate-spin")} />
          {labels.actualiser}
        </button>
      </div>
      {geoError && <p className="rounded-xl bg-red-500/10 p-2 text-xs font-bold text-red-500">{labels.geoDenied}</p>}

      {!hasTournee && (
        <p className="rounded-xl bg-amber-500/10 p-2.5 text-xs font-bold text-amber-600">{labels.noTournee}</p>
      )}

      <div className="sticky top-0">
        <Input placeholder={labels.searchClient} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        {list.map((c) => {
          const dist = meta(c.id);
          const url = mapsUrl(c);
          return (
            <div
              key={c.id}
              className="flex w-full items-center gap-2.5 rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-3"
            >
              <button
                onClick={() => router.push(`/${locale}/livreur/${day}/dashboard?client=${c.id}`)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--bg-sunken) text-base font-black">
                  {c.name.trim().charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black">{c.name}</span>
                  <span className="block truncate font-mono text-[11px] opacity-50" dir="ltr">{c.code}</span>
                  {dist && <span className="block truncate text-[11px] font-bold text-(--brand-600)">{dist}</span>}
                </span>
              </button>
              {url ? (
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
        {list.length === 0 && <p className="text-center text-sm opacity-60">{labels.empty}</p>}
      </div>

      <button
        onClick={() => router.push(`/${locale}/livreur/${day}/dashboard`)}
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-2 border-t border-(--border-default) bg-(--bg-overlay) py-3.5 text-base font-black lg:bottom-0"
      >
        {labels.skip} →
      </button>
    </div>
  );
}
