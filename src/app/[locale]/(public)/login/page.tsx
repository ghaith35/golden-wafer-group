import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isDesktopUserAgent, isLocalMode } from "@/lib/license/gate";
import { LoginForm } from "./LoginForm";
import { LanguageSwitcher } from "@/components/layout/TopBar";
import pkg from "../../../../../package.json";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Fresh install (no company yet) → owner creates credentials first.
  if ((await prisma.company.count()) === 0) redirect(`/${locale}/onboard`);
  const t = await getTranslations("app");
  // Password reset via activation key: desktop (EXE/DMG) installs only.
  const canReset = isLocalMode() && isDesktopUserAgent((await headers()).get("user-agent"));
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden">
      {/* Drenched olive night — lighter core, near-black edges */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 18%, #1a1408 0%, #0b0b0c 48%, #030303 100%)" }}
      />

      {/* Subtle plus-pattern texture */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='56' height='56' viewBox='0 0 56 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0h-2v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative z-10 w-full max-w-[400px] px-5 py-10 2xl:max-w-[430px]">
        {/* Brand header */}
        <div className="mb-7 text-center 2xl:mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/logo-192.png"
            alt="Golden Wafer"
            className="mb-5 inline-block h-16 w-16 rounded-[20px] 2xl:h-20 2xl:w-20"
            style={{ boxShadow: "0 0 55px -8px rgba(232,186,76,0.6), 0 0 0 1px rgba(232,186,76,0.25)" }}
          />
          <h1 className="text-[2rem] font-extrabold leading-none tracking-tight text-white 2xl:text-4xl" dir="ltr">
            <span>GOLDEN</span>
            <span className="text-[#e8ba4c]"> WAFER</span>
          </h1>
          <p className="mt-2.5 text-sm text-white/55">
            {t("tagline")}
          </p>
        </div>

        {/* Language pill */}
        <div className="mb-4 flex justify-center">
          <LanguageSwitcher tone="onDark" />
        </div>

        {/* Login card */}
        <div
          className="rounded-2xl border border-white/10 p-5 sm:p-6"
          style={{
            background: "rgba(255,255,255,0.045)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.45)",
          }}
        >
          <LoginForm dark canReset={canReset} />
        </div>

        {/* Footer */}
        <p className="mt-5 text-center text-xs text-white/35" dir="ltr">
          Distribuili · v{pkg.version}
        </p>
      </div>
    </main>
  );
}
