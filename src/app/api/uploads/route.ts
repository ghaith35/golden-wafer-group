import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { uploadsRoot } from "@/lib/uploads/store";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "missing_file" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "bad_type" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });

  // Optional subfolder (products | vans). Defaults to products for compat.
  const dirName = form?.get("dir");
  const sub = dirName === "vans" ? "vans" : "products";

  const ext = ALLOWED.get(file.type) ?? extname(file.name);
  const name = `${randomBytes(12).toString("hex")}${ext}`;
  // Persistent app-data storage (see src/lib/uploads/store.ts): bundle
  // public/ dirs are wiped from view on every update — uploads must not live
  // there or product images break after the next update.
  const dir = join(uploadsRoot(), sub);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ url: `/uploads/${sub}/${name}` }, { status: 201 });
}
