import { NextResponse } from "next/server";
import { getApkMeta, getWebBuildId } from "@/lib/update-feed";

export const dynamic = "force-dynamic";

/// Public update feed for the van phones (works before login):
/// web build id + latest APK (versionCode, name, size, download URL).
export async function GET() {
  try {
    const [buildId, apk] = await Promise.all([getWebBuildId(), getApkMeta()]);
    return NextResponse.json({ web: { buildId }, apk });
  } catch {
    return NextResponse.json({ web: { buildId: "" }, apk: null });
  }
}
