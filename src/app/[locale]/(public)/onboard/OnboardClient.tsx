"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  Eye,
  EyeOff,
  HandCoins,
  LoaderCircle,
  Mail,
  Package,
  Phone,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/layout/TopBar";

type OnboardLabels = Record<string, string>;

export function OnboardClient({
  locale,
  offlineInstall,
  labels,
}: {
  locale: string;
  offlineInstall: boolean;
  labels: OnboardLabels;
}) {
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isArabic = locale === "ar";

  // Single entry: details typed on the activation screen carry over here so
  // the owner never types them twice. A complete carry-over collapses this
  // screen to password-only (summary + password); otherwise the full form.
  const [prefill, setPrefill] = useState<{ company: string; name: string; phone: string; email: string } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("dili_onboard_prefill");
      if (!raw) return;
      const p = JSON.parse(raw) as { company?: string; name?: string; phone?: string; email?: string };
      const v = {
        company: typeof p.company === "string" ? p.company : "",
        name: typeof p.name === "string" ? p.name : "",
        phone: typeof p.phone === "string" ? p.phone : "",
        email: typeof p.email === "string" ? p.email : "",
      };
      if (v.company) setCompany((x) => x || v.company);
      if (v.name) setFullName((x) => x || v.name);
      if (v.phone) setPhone((x) => x || v.phone);
      setPrefill(v);
    } catch {
      /* no prefill */
    }
  }, []);
  const prefillEmail = prefill?.email || null;
  const slim = !!(prefill && prefill.company && prefill.name && prefill.phone && prefill.email);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          companyName: company.trim(),
          fullName: fullName.trim(),
          email: (prefillEmail ?? email).trim().toLowerCase(),
          phone: phone.trim(),
          password,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.error === "already_onboarded"
          ? labels.alreadyOnboarded
          : data?.error === "rate_limited"
            ? labels.rateLimited
            : data?.error === "validation_error"
              ? labels.validationError
              : labels.createFailed;
        setError(message);
        return;
      }
      try {
        localStorage.removeItem("dili_onboard_prefill");
      } catch {
        /* best-effort */
      }
      window.location.assign(`/${locale}/dashboard`);
    } catch {
      setError(labels.createFailed);
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "h-12 w-full rounded-md border border-[#eadfc2] bg-white px-3.5 text-[15px] text-[#1c1200] outline-none transition placeholder:text-[#686a74] focus:border-[#7b6b49] focus:ring-2 focus:ring-[#7b6b49]/15 disabled:opacity-60";
  const features = [
    { icon: Package, title: labels.inventoryTitle, detail: labels.inventoryDetail },
    { icon: UsersRound, title: labels.partnersTitle, detail: labels.partnersDetail },
    { icon: HandCoins, title: labels.accountsTitle, detail: labels.accountsDetail },
  ];
  const ForwardArrow = isArabic ? ArrowLeft : ArrowRight;

  return (
    <main
      dir={isArabic ? "rtl" : "ltr"}
      className="gw-bleed min-h-dvh bg-[#fbf8f1] text-[#1c1200] selection:bg-[#e8ba4c] selection:text-[#1c1200]"
    >
      <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
        {/* ── Brand panel ── */}
        <section className="relative flex flex-col justify-between gap-8 overflow-hidden bg-[#0b0b0c] px-6 py-6 text-white sm:px-10 sm:py-8 lg:min-h-dvh lg:gap-10 lg:px-10 lg:py-10 xl:px-14 2xl:px-16 2xl:py-12">
          <div className="pointer-events-none absolute inset-0 opacity-[0.11]" aria-hidden="true" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)", backgroundSize: "42px 42px", maskImage: "linear-gradient(to bottom, black, transparent 78%)" }} />
          {/* gold glow + faint wafer lattice: depth for the big-screen canvas */}
          <div className="pointer-events-none absolute -start-[18%] -top-[12%] h-[70%] w-[70%] rounded-full opacity-60 blur-3xl" aria-hidden="true" style={{ background: "radial-gradient(closest-side, rgba(232,186,76,.34), transparent 72%)" }} />
          <div className="pointer-events-none absolute -bottom-[22%] -end-[14%] h-[60%] w-[60%] rounded-full opacity-50 blur-3xl" aria-hidden="true" style={{ background: "radial-gradient(closest-side, rgba(201,149,26,.30), transparent 70%)" }} />
          <div className="pointer-events-none absolute inset-0 hidden opacity-[0.07] lg:block" aria-hidden="true" style={{ backgroundImage: "repeating-linear-gradient(45deg, #e8ba4c 0 1px, transparent 1px 34px), repeating-linear-gradient(-45deg, #e8ba4c 0 1px, transparent 1px 34px)", maskImage: "radial-gradient(ellipse at 30% 40%, black 0%, transparent 70%)" }} />
          <div className="gw-zoom relative z-10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/logo-192.png" alt="" className="h-10 w-10 rounded-xl sm:h-12 sm:w-12" />
              <span className="text-base font-black tracking-[0.04em] sm:text-lg" dir="ltr">GOLDEN WAFER</span>
            </div>
            <div className="rounded-full border border-white/20 bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-white/75">
              {labels.distributionLabel}
            </div>
          </div>

          <div className="gw-zoom gw-rise relative z-10 w-full max-w-md py-2 sm:py-4 lg:max-w-lg lg:py-6 2xl:max-w-xl">
            <h1 className="max-w-[13ch] text-4xl font-black leading-[1.18] text-white text-balance sm:text-5xl lg:text-[2.6rem] lg:leading-[1.2] 2xl:text-6xl 2xl:leading-[1.14]">
              {labels.heroTitle}
            </h1>
            <p className="mt-4 max-w-prose text-[15px] leading-7 text-[#d0d4df] sm:mt-5 sm:text-base sm:leading-8">
              {labels.heroCopy}
            </p>

            {/* Secondary on desktop, tucked away on small screens where the form is the task */}
            <div className="mt-8 hidden border-t border-white/15 lg:mt-10 lg:block">
              {features.map(({ icon: Icon, title, detail }) => (
                <div key={title} className="group flex items-center gap-4 border-b border-white/15 py-4 transition-colors duration-300 hover:bg-white/[0.03] 2xl:py-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#e8ba4c] text-[#0b0b0c] transition-transform duration-300 group-hover:scale-110 2xl:h-11 2xl:w-11">
                    <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-[15px] font-bold text-white 2xl:text-base">{title}</h2>
                    <p className="mt-0.5 text-[13px] leading-5 text-[#d9c58f] 2xl:text-sm">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="gw-zoom relative z-10 hidden items-center justify-between gap-4 border-t border-white/15 pt-5 text-xs text-[#d9c58f] lg:flex">
            <span className="flex items-center gap-2">
              {offlineInstall ? <WifiOff size={15} aria-hidden="true" /> : <Boxes size={15} aria-hidden="true" />}
              {offlineInstall ? labels.offlineNote : labels.startNote}
            </span>
            <span dir="ltr">GOLDEN WAFER</span>
          </div>
        </section>

        {/* ── Form panel ── */}
        <section className="relative flex items-center justify-center overflow-hidden px-5 py-8 sm:px-8 sm:py-10 lg:min-h-dvh lg:px-10 lg:py-12 xl:px-14 2xl:px-16">
          <div className="pointer-events-none absolute -end-[20%] -top-[18%] h-[60%] w-[60%] rounded-full opacity-70 blur-3xl" aria-hidden="true" style={{ background: "radial-gradient(closest-side, rgba(232,186,76,.22), transparent 70%)" }} />
          <div className="gw-zoom gw-rise relative w-full max-w-[440px] xl:max-w-[480px] 2xl:max-w-[520px]">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 2xl:mb-10">
              <div className="flex items-center gap-3" aria-label={labels.progressLabel}>
                {offlineInstall ? (
                  <>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f7dc8c] text-[#3a2b08]" aria-label={labels.complete}>
                      <Check size={17} strokeWidth={2.5} />
                    </span>
                    <span className="h-px w-8 bg-[#b6bbc5]" />
                  </>
                ) : null}
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3a2b08] text-sm font-bold text-white">
                  {offlineInstall ? "2" : "1"}
                </span>
                <span className="text-sm font-bold text-[#3a2b08]">
                  {offlineInstall ? labels.stepAccount : labels.stepSetup}
                </span>
              </div>
              <LanguageSwitcher />
            </div>

            <header className="mb-6 2xl:mb-8">
              <h2 className="text-[1.7rem] font-black leading-tight sm:text-4xl">{labels.title}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#7b6b49] sm:text-[15px]">{labels.subtitle}</p>
            </header>

            <form onSubmit={(event) => void submit(event)} className="space-y-4 2xl:space-y-5">
              {slim ? (
                <div className="rounded-xl border border-[#eadfc2] bg-white px-4 py-1">
                  {(
                    [
                      [labels.company, company],
                      [labels.fullName, fullName],
                      [labels.phone, phone],
                      [labels.email, prefillEmail ?? ""],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[#f3ecda] py-2.5 last:border-0">
                      <span className="shrink-0 text-xs font-bold text-[#616470]">{k}</span>
                      <span className="truncate text-sm font-bold text-[#1c1200]" dir="auto">{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
              <>
              <div>
                <label htmlFor="onboard-company" className="mb-1.5 block text-sm font-bold">{labels.company}</label>
                <input
                  id="onboard-company"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  className={inputClass}
                  autoComplete="organization"
                  maxLength={80}
                  required
                  disabled={busy}
                />
              </div>

              <div>
                <label htmlFor="onboard-fullname" className="mb-1.5 block text-sm font-bold">{labels.fullName}</label>
                <input
                  id="onboard-fullname"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className={inputClass}
                  autoComplete="name"
                  maxLength={80}
                  required
                  disabled={busy}
                />
              </div>

              {/* Side-by-side only when the column is wide enough to keep
                  both fields usable: full width below lg, stacked at lg,
                  back to two columns at xl. */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {!prefillEmail && (
                <div>
                  <label htmlFor="onboard-email" className="mb-1.5 block text-sm font-bold">{labels.email}</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-[#a99c7a] ltr:left-3 rtl:right-3" aria-hidden="true" />
                    <input
                      id="onboard-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className={`${inputClass} ltr:pl-10 rtl:pr-10`}
                      dir="ltr"
                      autoComplete="email"
                      maxLength={254}
                      required
                      disabled={busy}
                    />
                  </div>
                </div>
                )}
                <div>
                  <label htmlFor="onboard-phone" className="mb-1.5 block text-sm font-bold">{labels.phone}</label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-[#a99c7a] ltr:left-3 rtl:right-3" aria-hidden="true" />
                    <input
                      id="onboard-phone"
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className={`${inputClass} ltr:pl-10 rtl:pr-10`}
                      dir="ltr"
                      autoComplete="tel"
                      maxLength={30}
                      required
                      disabled={busy}
                    />
                  </div>
                </div>
              </div>
              {prefillEmail && (
                <p className="-mt-1 text-xs text-[#7b6b49]" dir="ltr">{labels.email}: {prefillEmail}</p>
              )}
              </>
              )}

              <div>
                <label htmlFor="onboard-password" className="mb-1.5 block text-sm font-bold">{labels.password}</label>
                <div className="relative">
                  <input
                    id="onboard-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={`${inputClass} ltr:pr-12 rtl:pl-12`}
                    dir="ltr"
                    autoComplete="new-password"
                    maxLength={100}
                    required
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-[#7b6b49] hover:bg-[#f3ecda] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3a2b08] ltr:right-1 rtl:left-1"
                    aria-label={showPassword ? labels.hidePassword : labels.showPassword}
                    title={showPassword ? labels.hidePassword : labels.showPassword}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-md border border-[#e6c7c0] bg-[#fff4f1] px-3.5 py-3 text-sm font-medium text-[#9f3f31]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="group mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-md bg-[#3a2b08] px-5 text-base font-bold text-white transition hover:bg-[#252c4a] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#3a2b08] disabled:cursor-wait disabled:opacity-70"
              >
                {busy ? <LoaderCircle size={19} className="animate-spin" aria-hidden="true" /> : null}
                <span>{busy ? labels.creating : labels.submit}</span>
                {!busy ? <ForwardArrow size={18} className={isArabic ? "transition-transform group-hover:-translate-x-1" : "transition-transform group-hover:translate-x-1"} aria-hidden="true" /> : null}
              </button>
              <p className="pt-1 text-center text-xs leading-5 text-[#7b6b49]">{labels.loginHint}</p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
