import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveTrackVan } from "@/lib/track";

/// APK live-position report. Called by the driver's phone every ~30-60s.
///
/// Auth (one of):
///   - deviceToken: the device token provisioned in Settings → Devices
///   - qrToken: the staff member's QR login token (from their account card)
///
/// Body: { deviceToken?, qrToken?, lat, lng, accuracy?, speed? }
/// Resolves the van from the device binding (or the staff member's assigned
/// van) and stamps Store.lastLat/lastLng/lastSeenAt, shown live on /suivi.
///
/// Response includes `locateRequested`: true when the admin pressed
/// "request location" — the APK should report immediately (it already is).
const trackSchema = z.object({
  deviceToken: z.string().min(8).max(128).nullish(),
  qrToken: z.string().min(8).max(128).nullish(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100000).nullish(),
  speed: z.number().finite().min(0).max(500).nullish(),
});

export async function POST(req: Request) {
  const parsed = trackSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  }
  const { deviceToken, qrToken, lat, lng } = parsed.data;

  const resolved = await resolveTrackVan(deviceToken, qrToken);
  if (!resolved) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!resolved.vanId) return NextResponse.json({ error: "no_van", detail: "device/user has no van assigned" }, { status: 400 });

  if (resolved.deviceId) {
    await prisma.device.update({ where: { id: resolved.deviceId }, data: { lastSyncAt: new Date() } }).catch(() => {});
  }
  // A fresh report answers any pending locate request — clear the flag.
  const van = await prisma.store.update({
    where: { id: resolved.vanId },
    data: { lastLat: lat, lastLng: lng, lastSeenAt: new Date(), locateRequestedAt: null },
    select: { id: true, name: true, lastSeenAt: true },
  });
  return NextResponse.json({ ok: true, vanId: van.id, name: van.name, seenAt: van.lastSeenAt, locateRequested: false });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST { deviceToken|qrToken, lat, lng, accuracy?, speed? }",
  });
}
