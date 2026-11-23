import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveTrackVan } from "@/lib/track";
import { recordPositions } from "@/lib/track-store";

/// APK always-on location service: a batch of fixes (queued while the phone had
/// no signal, then flushed) plus the phone's own tracking-health report.
/// Auth: deviceToken (provisioned device) or qrToken, like POST /api/track.
const positionSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100000).nullish(),
  speed: z.number().finite().min(0).max(500).nullish(),
  t: z.number().finite().nullish(),
});
const batchSchema = z.object({
  deviceToken: z.string().min(8).max(128).nullish(),
  qrToken: z.string().min(8).max(128).nullish(),
  positions: z.array(positionSchema).max(300).default([]),
  state: z
    .object({
      fine: z.boolean().optional(), always: z.boolean().optional(), notifications: z.boolean().optional(),
      battery: z.boolean().optional(), service: z.boolean().optional(), gps: z.boolean().optional(),
      queued: z.number().int().min(0).max(100000).optional(), app: z.string().max(40).optional(),
    })
    .nullish(),
});

export async function POST(req: Request) {
  const parsed = batchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const { deviceToken, qrToken, positions, state } = parsed.data;
  const resolved = await resolveTrackVan(deviceToken, qrToken);
  if (!resolved) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!resolved.vanId) return NextResponse.json({ error: "no_van" }, { status: 400 });
  if (resolved.deviceId) {
    await prisma.device.update({ where: { id: resolved.deviceId }, data: { lastSyncAt: new Date() } }).catch(() => {});
  }
  const r = await recordPositions(resolved.companyId, resolved.vanId, positions, state ?? null);
  const van = await prisma.store.findUnique({ where: { id: resolved.vanId }, select: { locateRequestedAt: true } });
  return NextResponse.json({ ok: true, kept: r.kept, locateRequested: van?.locateRequestedAt != null });
}
