import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { UiZoomBoot } from "@/components/layout/UiZoomBoot";
import { ModalGuard } from "@/components/layout/ModalGuard";
import { DataSyncBoot } from "@/components/layout/DataSyncBoot";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={messages}>
      <UiZoomBoot />
      <ModalGuard />
      <DataSyncBoot />
      {children}
    </NextIntlClientProvider>
  );
}
