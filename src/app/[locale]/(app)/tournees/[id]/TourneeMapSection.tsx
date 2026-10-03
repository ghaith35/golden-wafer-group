"use client";

import dynamic from "next/dynamic";
import type { MapStop } from "@/components/map/TourneeMap";

const TourneeMap = dynamic(() => import("@/components/map/TourneeMap").then((m) => m.TourneeMap), {
  ssr: false,
  loading: () => <div className="flex h-64 items-center justify-center rounded-2xl bg-(--bg-sunken) text-sm opacity-60">🗺…</div>,
});

export function TourneeMapSection({ stops }: { stops: MapStop[] }) {
  if (!stops.some((s) => s.lat != null && s.lng != null)) return null;
  return <TourneeMap stops={stops} showRoute saveTiles followVendeur height={360} />;
}
