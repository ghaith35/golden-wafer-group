import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadsRoot } from "@/lib/uploads/store";

export const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/// "data:image/jpeg;base64,…" → bytes, only if it really is a JPEG (the phone
/// always re-encodes to JPEG). Anything else / oversize → null.
export function decodeJpegDataUrl(v: unknown): Buffer | null {
  if (typeof v !== "string") return null;
  const m = /^data:image\/jpe?g;base64,([A-Za-z0-9+/=\s]+)$/.exec(v);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 4 || buf.length > MAX_PHOTO_BYTES) return null;
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return null;
  return buf;
}

export type ClosedVisitInput = {
  companyId: string;
  userId: string;
  vanId: string | null;
  opId: string;
  occurredAt: Date;
  clientId: string;
  note: string | null;
  lat: number | null;
  lng: number | null;
  photos: unknown;
};

/// Store the photos in persistent upload storage and record the visit.
/// Throws coded errors (status 400) the sync engine reports back to the phone.
export async function createClosedVisit(i: ClosedVisitInput): Promise<string> {
  const client = await prisma.customer.findFirst({ where: { id: i.clientId, companyId: i.companyId }, select: { id: true } });
  if (!client) throw Object.assign(new Error("bad_client"), { status: 400 });
  const raw = Array.isArray(i.photos) ? i.photos : [];
  if (raw.length < 1 || raw.length > MAX_PHOTOS) throw Object.assign(new Error("bad_photos"), { status: 400 });
  const bufs = raw.map(decodeJpegDataUrl);
  if (bufs.some((b) => !b)) throw Object.assign(new Error("bad_photos"), { status: 400 });

  const dir = join(uploadsRoot(), "closed");
  await mkdir(dir, { recursive: true });
  const saved: Array<{ file: string; url: string }> = [];
  try {
    for (const b of bufs as Buffer[]) {
      const name = `${randomBytes(12).toString("hex")}.jpg`;
      await writeFile(join(dir, name), b);
      saved.push({ file: join(dir, name), url: `/uploads/closed/${name}` });
    }
    const row = await prisma.closedVisit.create({
      data: {
        companyId: i.companyId,
        customerId: client.id,
        locationId: i.vanId,
        userId: i.userId,
        opId: i.opId,
        note: i.note ? i.note.slice(0, 500) : null,
        lat: i.lat,
        lng: i.lng,
        occurredAt: i.occurredAt,
        photos: { create: saved.map((s, n) => ({ url: s.url, sortOrder: n })) },
      },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    // Don't leave orphan files behind a failed/duplicate insert.
    await Promise.all(saved.map((s) => unlink(s.file).catch(() => {})));
    throw e;
  }
}
