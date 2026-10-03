import { redirect } from "next/navigation";

/// Locale home (/ar, /fr, /en) → dashboard (auth guard redirects to login).
export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard`);
}
