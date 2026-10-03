import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getOrCreateSettings } from "@/lib/settings/helpers";

/// Non-admin-safe settings subset for app chrome (sidebar, feature gates).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = await getOrCreateSettings(session.companyId);
  return NextResponse.json({ gpsEnabled: s.gpsEnabled ?? true, qrStrictMode: s.qrStrictMode ?? false });
}
