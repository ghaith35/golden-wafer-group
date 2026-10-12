import { redirect } from "next/navigation";

// Vendor rule: the journal block is hidden from client Settings.
// The standalone journal route (reports) is untouched.
export default async function SettingsJournalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/settings`);
}
