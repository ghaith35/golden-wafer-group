import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveTrackVan } from "@/lib/track";

/// Lightweight APK poll (no position needed): asks "does the office want my
/// location right now?" The APK should call this every ~30s (or check the
/// `locateRequested` field of POST /api/track responses) and immediately
/// POST its position when true.
const pendingSchema = z.object({
  deviceToken: z.string().min(8).max(128).nullish(),
  qrToken: z.string().min(8).max(128).nullish(),
});

export async function POST(req: Request) {
  const parsed = pendingSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  }
  const resolved = await resolveTrackVan(parsed.data.deviceToken, parsed.data.qrToken);
  if (!resolved) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!resolved.vanId) return NextResponse.json({ error: "no_van" }, { status: 400 });
  const van = await prisma.store.findUnique({
    where: { id: resolved.vanId },
    select: { id: true, locateRequestedAt: true },
  });
  return NextResponse.json({ vanId: van?.id ?? resolved.vanId, locateRequested: van?.locateRequestedAt != null });
}
