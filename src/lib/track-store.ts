import { prisma } from "@/lib/db";

/// Position history of the van phones. The APK's always-on location service
/// sends fixes in batches (queued while offline), each with the time the phone
/// took it — the server keeps the full trail and mirrors the newest fix onto
/// the van row (the fast path for the live map).

export type IncomingPosition = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  /// Epoch ms when the phone took the fix. Missing = now.
  t?: number | null;
};

/// What the phone says about its own tracking health (shown to the office).
export type TrackState = {
  /// Fine-location permission.
  fine?: boolean;
  /// "Allow all the time" (background location).
  always?: boolean;
  notifications?: boolean;
  /// Battery optimisation switched off for the app.
  battery?: boolean;
  /// The always-on service is running.
  service?: boolean;
  /// Location (GPS) switched on in the phone's settings.
  gps?: boolean;
  queued?: number;
  app?: string;
};

export const TRAIL_RETENTION_DAYS = 30;
const MAX_BATCH = 300;
const PAST_LIMIT = 7 * 86_400_000;
const FUTURE_LIMIT = 2 * 60_000;

/// Store a batch for one van. Returns how many NEW positions were kept.
export async function recordPositions(
  companyId: string,
  vanId: string,
  positions: IncomingPosition[],
  state?: TrackState | null,
): Promise<{ kept: number; newestAt: Date | null }> {
  const now = Date.now();
  const clean = positions
    .slice(0, MAX_BATCH)
    .map((p) => {
      let t = typeof p.t === "number" && Number.isFinite(p.t) ? p.t : now;
      // A wrong phone clock must never put a point in the future or months back.
      if (t > now + FUTURE_LIMIT) t = now;
      if (t < now - PAST_LIMIT) return null;
      return { lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, speed: p.speed ?? null, recordedAt: new Date(Math.trunc(t)) };
    })
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  let kept = 0;
  let newestAt: Date | null = null;
  if (clean.length) {
    // The same fix can arrive twice (a retry after a dropped response): skip known timestamps.
    const have = await prisma.vanPosition.findMany({
      where: { vanId, recordedAt: { gte: clean[0].recordedAt, lte: clean[clean.length - 1].recordedAt } },
      select: { recordedAt: true },
    });
    const known = new Set(have.map((h) => h.recordedAt.getTime()));
    const fresh = clean.filter((p) => !known.has(p.recordedAt.getTime()));
    if (fresh.length) {
      await prisma.vanPosition.createMany({ data: fresh.map((p) => ({ companyId, vanId, ...p })) });
    }
    kept = fresh.length;
    newestAt = clean[clean.length - 1].recordedAt;
  }

  const van = await prisma.store.findUnique({ where: { id: vanId }, select: { lastSeenAt: true, locateRequestedAt: true } });
  const newest = clean[clean.length - 1];
  const data: Record<string, unknown> = {};
  // The live map always shows the newest fix the phone ever took.
  if (newest && (!van?.lastSeenAt || newest.recordedAt >= van.lastSeenAt)) {
    data.lastLat = newest.lat;
    data.lastLng = newest.lng;
    data.lastSeenAt = newest.recordedAt;
  }
  // An old queued fix must not count as the answer to a fresh locate request.
  if (van?.locateRequestedAt && newest && newest.recordedAt.getTime() >= van.locateRequestedAt.getTime() - 5_000) {
    data.locateRequestedAt = null;
  }
  if (state) data.lastTrackState = JSON.stringify({ ...state, at: new Date().toISOString() });
  if (Object.keys(data).length) await prisma.store.update({ where: { id: vanId }, data });

  // Housekeeping, cheaply and rarely: the trail keeps the last 30 days.
  if (Math.random() < 0.01) {
    await prisma.vanPosition
      .deleteMany({ where: { companyId, recordedAt: { lt: new Date(now - TRAIL_RETENTION_DAYS * 86_400_000) } } })
      .catch(() => {});
  }
  return { kept, newestAt };
}
