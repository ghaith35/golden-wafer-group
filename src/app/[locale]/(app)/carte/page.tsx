import { redirect } from "next/navigation";

/// الخريطة now lives inside تتبع GPS (/suivi) — old links and bookmarks land there.
export default async function CartePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/suivi`);
}
