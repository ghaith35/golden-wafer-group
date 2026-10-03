import { redirect } from "next/navigation";

// Merged into the purchases master-detail list (kept for old bookmarks).
export default async function PurchaseDetailIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/purchases`);
}
