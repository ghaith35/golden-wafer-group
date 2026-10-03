import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { JournalClient } from "./JournalClient";

export default async function JournalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  const t = await getTranslations("reports");
  return (
    <JournalClient
      labels={{
        title: t("journal"), sales: t("sales"), paid: t("paid"),
        versements: t("versements"), expenses: t("expenses"),
      }}
    />
  );
}
