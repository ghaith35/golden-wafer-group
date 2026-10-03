import { redirect } from "next/navigation";

// Moved into Settings → /settings/devices (kept for old bookmarks/deep links).
// The per-device page at /devices/[id] is unchanged.
export default async function DevicesIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/settings/devices`);
}
