import { redirect } from "next/navigation";

// Vendor-controlled section (costing + van binding): hidden from the client.
// The values stay in the DB as the vendor set them; direct links land here.
export default async function GeneralSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/settings`);
}

