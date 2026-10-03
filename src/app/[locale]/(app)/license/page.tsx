import { redirect } from "next/navigation";

// Moved into Settings → /settings/license (kept for old bookmarks/deep links).
export default async function LicenseIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/settings/license`);
}
