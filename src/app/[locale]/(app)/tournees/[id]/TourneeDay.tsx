"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { useLivePosition, formatDist, formatTime } from "@/lib/geo";
import { dzMoney } from "@/lib/format";
import { Crosshair, Navigation } from "lucide-react";

export type Stop = {
  id: string;
  position: number;
  visited: boolean;
  sold: boolean;
  skipped: boolean;
  total: unknown;
  client: { id: string; name: string; code: string; phone: string | null; gpsLat: number | null; gpsLng: number | null };
};

export function TourneeDay({
  locale,
  stops,
  sales,
  labels,
}: {
  locale: string;
  tourneeId: string;
  locationId: string;
  isOpen: boolean;
  stops: Stop[];
  sales: Array<{ id: string; number: string; total: unknown; client: { name: string } | null }>;
  labels: Record<string, string>;
  /// Refresh parent (board reload / page refresh) after any mutation.
  onChanged?: () => void;
}) {
  const { pos, locating, geoError, locate } = useLivePosition();

  const metaOf = (lat: unknown, lng: unknown): string | null => {
    const d = formatDist(pos, lat, lng, labels.unitM, labels.unitKm);
    const t = formatTime(pos, lat, lng, labels.unitMin);
    if (!d || !t) return null;
    return `${d} · ${t}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase opacity-60">
          {labels.stops} ({stops.length})
        </div>
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="flex items-center gap-1 rounded-lg bg-(--bg-sunken) px-2.5 py-1.5 text-xs font-black disabled:opacity-50"
        >
          <Crosshair size={13} className={locating ? "animate-spin" : ""} />
          {locating ? "…" : labels.locate}
        </button>
      </div>
      {geoError && <p className="text-xs font-bold text-red-500">{labels.geoDenied}</p>}
      {stops.map((s, i) => {
        const meta = metaOf(s.client.gpsLat, s.client.gpsLng);
        // Exact coords when available, otherwise Maps text-search by name.
        const gpsUrl =
          s.client.gpsLat != null && s.client.gpsLng != null
            ? `https://www.google.com/maps?q=${s.client.gpsLat},${s.client.gpsLng}`
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.client.name)}`;
        return (
          <Card key={s.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">
                  <span className="me-1 rounded bg-(--bg-sunken) px-1.5 font-mono">{i + 1}</span>
                  {s.client.name} <span className="font-mono text-xs opacity-50" dir="ltr">{s.client.code}</span>
                </div>
                {s.client.phone && <div className="text-xs opacity-60" dir="ltr">📞 <bdi>{s.client.phone}</bdi></div>}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {meta && (
                    <span className="font-mono text-[11px] font-bold text-sky-600" dir="ltr">{meta}</span>
                  )}
                </div>
              </div>
              <a
                href={gpsUrl}
                target="_blank"
                rel="noreferrer"
                title="GPS"
                aria-label="GPS"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--brand-500)/10 text-(--brand-600) transition-colors hover:bg-(--brand-500)/20"
              >
                <Navigation size={18} />
              </a>
            </div>
          </Card>
        );
      })}
      {sales.length > 0 && (
        <Card>
          <div className="mb-1 text-sm font-bold">{labels.sales ?? "Ventes"}</div>
          {sales.map((x) => (
            <Link key={x.id} href={`/${locale}/sales/${x.id}`} className="flex justify-between py-1 text-sm">
              <span className="min-w-0"><bdi dir="ltr">{x.number}</bdi> · <bdi dir="auto">{x.client?.name}</bdi></span>
              <span className="shrink-0 font-black">{dzMoney(Number(x.total))}</span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
