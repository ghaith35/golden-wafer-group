import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { SwRegister } from "@/components/pwa/SwRegister";
import { OfflineBackGuard } from "@/components/pwa/OfflineBackGuard";
import "./fonts.css";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Distribuili — Distribution Management",
  description: "Wholesale distribution ERP: clients, suppliers, stock, sales, purchases, debts.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Cairo carries every UI string — Arabic copy alongside Latin digits
            and codes — so preload both subsets instead of letting the CSS
            discover them late. */}
        <link rel="preload" href="/fonts/cairo-var-arabic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/cairo-var-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        {/* Theme init must run before paint: plain script in <head> is
            blocking by default — next/script beforeInteractive must NOT be
            nested here (React warns: script tag inside component). */}
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('distribuili-theme')||'light';var n=localStorage.getItem('distribuili-theme-name')||'ocean';if(!localStorage.getItem('distribuili-blue-v1')){n='ocean';localStorage.setItem('distribuili-theme-name',n);localStorage.setItem('distribuili-blue-v1','1')};var known=['emerald','ocean','indigo','royal','crimson','sunset','amber','khiata','forest','teal','rose','mono','coffee','midnight','magenta','cyan','coral','plum','lime','burgundy','olive','sand','arctic','chocolate'];if(known.indexOf(n)<0)n='ocean';document.documentElement.dataset.theme=n;if(m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      {/* suppressHydrationWarning: browser extensions sometimes add their own
          attributes to <body> before React hydrates. */}
      <body suppressHydrationWarning>
        <SwRegister />
        <OfflineBackGuard />
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
