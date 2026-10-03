import { redirect } from "next/navigation";

/// Orders moved out of sales: commandes live in الطلبات only.
export default async function NewOrderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/commandes`);
}
