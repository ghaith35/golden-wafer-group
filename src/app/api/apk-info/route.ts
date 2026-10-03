import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/// Public update feed for the van phones (works before login):
/// web build id + latest APK (versionCode, name, size, download URL).
export async function GET() {
  try {
    const root = process.cwd();
    const gradle = await readFile(join(root, "android", "app", "build.gradle"), "utf-8").catch(() => "");
    const code = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0);
    const name = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? "";
    let buildId = "";
    try {
      buildId = (await readFile(join(root, ".next", "BUILD_ID"), "utf-8")).trim();
    } catch {
      /* dev mode */
    }
    let apk: { size: number; builtAt: string } | null = null;
    try {
      const st = await stat(join(root, "public", "apk", "Distribuili-Van.apk"));
      apk = { size: st.size, builtAt: st.mtime.toISOString() };
    } catch {
      /* not published yet */
    }
    return NextResponse.json({
      web: { buildId },
      apk: code > 0 ? { versionCode: code, versionName: name, ...apk, url: "/apk/Distribuili-Van.apk" } : null,
    });
  } catch {
    return NextResponse.json({ web: { buildId: "" }, apk: null });
  }
}
