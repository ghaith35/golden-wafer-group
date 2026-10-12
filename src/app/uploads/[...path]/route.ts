import { NextResponse } from "next/server";
import { readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UPLOAD_SUBS, uploadsRoot, isSafeUploadName, findLegacyUpload } from "@/lib/uploads/store";

const CONTENT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/// Serves /uploads/<sub>/<file> from persistent app-data storage (see
/// src/lib/uploads/store.ts). App routes take precedence over public/ files,
/// so this also heals pre-fix uploads: first hit in a legacy bundle/baked
/// dir is copied up into storage, then served.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const parts = await params;
  const [sub, name] = parts.path ?? [];
  if (!sub || !name || !(UPLOAD_SUBS as readonly string[]).includes(sub) || !isSafeUploadName(name)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const dest = join(uploadsRoot(), sub, name);
  if (!existsSync(dest)) {
    // Self-heal: rescue from a legacy location on first hit after an update.
    const legacy = findLegacyUpload(sub, name);
    if (!legacy) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      await mkdir(join(uploadsRoot(), sub), { recursive: true });
      await copyFile(legacy, dest);
    } catch {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }
  try {
    const data = await readFile(dest);
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": CONTENT[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
