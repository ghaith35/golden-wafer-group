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
  title: "Golden Wafer Group",
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
            __html: `(function(){try{var m=localStorage.getItem('distribuili-theme')||'light';if(m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
        {/* Saved interface zoom must also be applied before the first paint —
            otherwise every refresh renders at 100% and then jumps to the
            chosen zoom (visible de-zoom/re-zoom). Mirrors apply() in
            src/lib/ui-zoom.ts for the CSS-zoom path (web / APK); the desktop
            shell's native-zoom bridge is left to UiZoomBoot. */}
        <script
          id="zoom-init"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(window.distribuili&&window.distribuili.setZoom)return;var r=localStorage.getItem('dili_ui_zoom');if(r===null)return;var n=Math.min(150,Math.max(70,Math.round(Number(r)/10)*10));if(!isFinite(n)||n===100)return;var d=document.documentElement;d.style.zoom=String(n/100);d.setAttribute('data-ui-zoom',String(n));d.style.setProperty('--ui-zoom',String(n/100))}catch(e){}})()`,
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
