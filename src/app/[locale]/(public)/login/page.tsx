import { setRequestLocale, getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";
import { LanguageSwitcher } from "@/components/layout/TopBar";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");
  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background gradient — deep lime night */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0d1804 0%, #243d0b 45%, #0e1c05 100%)" }} />

      {/* Decorative grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0h-2v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Decorative glowing orbs */}
      <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-25 blur-[120px]" style={{ background: "radial-gradient(circle, #84cc16 0%, transparent 70%)" }} />
      <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] rounded-full opacity-20 blur-[100px]" style={{ background: "radial-gradient(circle, #65a30d 0%, transparent 70%)" }} />

      <div className="relative z-10 w-full max-w-[420px] px-5 py-12">
        {/* Brand header */}
        <div className="mb-10 text-center">
          {/* Logo mark — the real app icon */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/logo-192.png"
            alt="Distribuili"
            className="inline-block h-20 w-20 rounded-[22px] mb-5"
            style={{ boxShadow: "0 0 50px -10px rgba(132,204,22,0.55)" }}
          />

          <h1 className="text-4xl font-extrabold tracking-tight text-white" dir="ltr">
            <span>DISTRIB</span>
            <span
              style={{
                background: "linear-gradient(135deg, #d9f99d, #84cc16 50%, #65a30d)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >UILI</span>
          </h1>
          <p className="mt-2 text-sm text-lime-100/60">
            {t("tagline")}
          </p>
        </div>

        {/* Login card */}
        <div className="mb-4 flex justify-center">
          <LanguageSwitcher />
        </div>
        <div className="rounded-2xl border border-white/10 p-6"
          style={{
            background: "rgba(255,255,255,0.05)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.45)",
          }}
        >
          <LoginForm dark />
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-lime-100/40" dir="ltr">
          Distribuili · v0.1.0
        </p>
      </div>
    </main>
  );
}
