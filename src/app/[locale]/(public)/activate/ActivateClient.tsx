"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Check,
  Copy,
  Hourglass,
  KeyRound,
  Loader2,
  Lock,
  MessageCircle,
  Phone,
  Rocket,
  Store,
  User,
  MapPin,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/layout/TopBar";
import pkg from "../../../../../package.json";

type Status = {
  activated: boolean;
  inTrial: boolean;
  expired: boolean;
  daysLeft: number;
  trialEnd: string | null;
  activationKey: string | null;
  machineId: string;
  devBypass?: boolean;
  serverUrl?: string;
  error?: string;
  revoked?: boolean;
  locked?: boolean;
};

type Bridge = {
  licenseStatus: () => Promise<Status>;
  licenseRegister?: (label?: string, phone?: string, info?: Record<string, string>) => Promise<Status>;
  licenseStartTrial: (info: Record<string, string>) => Promise<Status>;
  licenseCheck: () => Promise<Status>;
  licenseRedeemKey: (key: string, label?: string, info?: Record<string, string>) => Promise<Status>;
};

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { distribuili?: Bridge };
  return w.distribuili ?? null;
}

const isDesktop = () => bridge() !== null;

/// Algerian mobile only (mirrors server validDzPhone): 05/06/07 + 8 digits.
const DZ_PHONE = /^0[567]\d{8}$/;

const TRIAL_DAYS = 14;

function TrialRing({ daysLeft, label }: { daysLeft: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, daysLeft / TRIAL_DAYS));
  return (
    <div className="relative h-24 w-24">
      <svg viewBox="0 0 84 84" className="h-24 w-24 -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="8" className="stroke-white/10" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className="stroke-[#e8ba4c] transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums text-white" dir="ltr">
          {daysLeft}
        </span>
        <span className="text-[10px] font-bold uppercase text-white/50">{label}</span>
      </div>
    </div>
  );
}

export function ActivateClient({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [tab, setTab] = useState<"trial" | "activate">("trial");
  const [busy, setBusy] = useState<"trial" | "check" | "key" | null>(null);
  const [phase, setPhase] = useState<"idle" | "waiting">("idle");
  const [waitedLong, setWaitedLong] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Two-pass render: the server prerender has no window.electron bridge, so
  // the first client render must match it. Only after mount do we branch on
  // isDesktop() — otherwise React hydration (#418) fatals in production.
  const [mounted, setMounted] = useState(false);

  const [shop, setShop] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [trialError, setTrialError] = useState<string | null>(null);

  const [checkPhone, setCheckPhone] = useState("");
  const [checkPhoneError, setCheckPhoneError] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [shortKey, setShortKey] = useState("");

  const dir = locale === "ar" ? "rtl" : "ltr";
  const supportPhone = (labels.supportPhone ?? "").trim();

  // Owner details collected once here: sent to the license server with every
  // activation path, and carried into the onboard form so nothing is retyped.
  function collectInfo(ph: string): Record<string, string> {
    const info: Record<string, string> = {};
    const w = shop.trim();
    if (w) info.workshop = w;
    const n = name.trim();
    if (n) info.name = n;
    const c = city.trim();
    if (c) info.city = c;
    const p = (ph || phone).trim();
    if (p) info.phone = p;
    const e = email.trim().toLowerCase();
    if (e) info.email = e;
    return info;
  }

  function savePrefill() {
    try {
      localStorage.setItem(
        "dili_onboard_prefill",
        JSON.stringify({
          company: shop.trim(),
          name: name.trim(),
          phone: (phone || checkPhone).trim(),
          city: city.trim(),
          email: email.trim().toLowerCase(),
        })
      );
    } catch {
      /* best-effort */
    }
  }
  // Packaged desktop builds (DMG/EXE) are activation-only — the free-trial
  // tab is hidden there (bridge present = running inside the desktop shell).
  // Plain web keeps both tabs.
  const trialHidden = mounted && isDesktop();
  const activeTab = trialHidden ? ("activate" as const) : tab;

  const refresh = useCallback(async () => {
    const b = bridge();
    if (!b) return;
    try {
      setSt(await b.licenseStatus());
    } catch {
      /* offline shell — keep skeleton */
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    void refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const machineId = st?.machineId ?? "";
  const waText = encodeURIComponent(
    `${labels.waMessage ?? "Hello, please activate my device."}\nID: ${machineId || "—"}\n${shop.trim() || name.trim() || phone.trim() || ""}`.trim()
  );

  const goOnboard = useCallback(() => {
    window.location.assign(`/${locale}/onboard`);
  }, [locale]);

  const enter = useCallback(
    (msg: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      setPhase("idle");
      setOkMsg(msg);
      setTimeout(goOnboard, 900);
    },
    [goOnboard]
  );

  function validPhone(p: string, setErrFn: (s: string) => void): boolean {
    const v = p.trim();
    if (!v) {
      setErrFn(labels.phoneRequired);
      return false;
    }
    if (!DZ_PHONE.test(v)) {
      setErrFn(labels.phoneInvalid);
      return false;
    }
    setErrFn("");
    return true;
  }

  async function startTrial() {
    if (!validPhone(phone, setPhoneError)) return;
    if (!shop.trim()) {
      setTrialError(labels.shopRequired);
      return;
    }
    const b = bridge();
    if (!b) return;
    setBusy("trial");
    setTrialError(null);
    setErr(null);
    try {
      const s = await b.licenseStartTrial({
        label: shop.trim(),
        workshop: shop.trim(),
        name: name.trim() || undefined,
        phone: phone.trim(),
        city: city.trim() || undefined,
      } as Record<string, string>);
      setSt(s);
      if (s.revoked || s.locked) {
        setTrialError(labels.lockedMsg);
        return;
      }
      if (s.error === "network" || s.error === "no_internet") {
        setTrialError(labels.noInternet);
        return;
      }
      if (s.error === "trial_blocked") {
        setTrialError(labels.trialBlocked);
        return;
      }
      if (s.error === "bad_phone") {
        setPhoneError(labels.phoneInvalid);
        return;
      }
      if (s.error) {
        setTrialError(labels.genericError);
        return;
      }
      if (s.activated || s.inTrial) {
        savePrefill();
        enter(labels.trialOk);
      } else setTrialError(labels.genericError);
    } finally {
      setBusy(null);
    }
  }

  async function checkActivation() {
    if (!validPhone(checkPhone, setCheckPhoneError)) return;
    const b = bridge();
    if (!b) return;
    setBusy("check");
    setErr(null);
    try {
      await b.licenseRegister?.(shop.trim() || undefined, checkPhone.trim(), collectInfo(checkPhone))?.catch(() => {});
      const s = await b.licenseCheck();
      const full = await b.licenseStatus().catch(() => s);
      setSt(full);
      if (full.locked || full.revoked) {
        setErr(labels.lockedMsg);
        return;
      }
      if (full.activated || full.inTrial) {
        if (full.activationKey) setSavedKey(full.activationKey);
        savePrefill();
        enter(labels.successMsg);
        return;
      }
      setPhase("waiting"); // not activated yet → live auto-poll
    } finally {
      setBusy(null);
    }
  }

  // Live pickup: while waiting, re-read status every 4s and advance the moment
  // the seller activates this machine — no second click needed.
  useEffect(() => {
    if (phase !== "waiting") return;
    const b = bridge();
    if (!b) return;
    const id = setInterval(async () => {
      try {
        const s = await b.licenseStatus();
        setSt(s);
        if (s.locked || s.revoked) {
          clearInterval(id);
          setPhase("idle");
          setErr(labels.lockedMsg);
          return;
        }
        if (s.activated || s.inTrial) {
          clearInterval(id);
          if (s.activationKey) setSavedKey(s.activationKey);
          enter(labels.successMsg);
        }
      } catch {
        /* transient / offline — keep polling */
      }
    }, 4000);
    pollRef.current = id;
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // After ~45s of waiting, nudge toward WhatsApp so nobody stares at a
  // spinner with no next step.
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setTimeout(() => setWaitedLong(true), 45000);
    return () => {
      clearTimeout(id);
      setWaitedLong(false);
    };
  }, [phase]);

  // One card, one button: a typed key redeems, otherwise the phone number
  // is checked against the seller-side activation (live pickup included).
  async function submitActivation() {
    if (busy) return;
    if (shortKey.trim()) {
      await redeemKey();
      return;
    }
    await checkActivation();
  }

  async function redeemKey() {
    const b = bridge();
    if (!b || !shortKey.trim()) return;
    setBusy("key");
    setErr(null);
    try {
      const s = await b.licenseRedeemKey(shortKey.trim().toUpperCase(), shop.trim() || undefined, collectInfo(checkPhone));
      const full = await b.licenseStatus().catch(() => s);
      setSt(full as Status);
      if ((s as Status).error === "key_already_used") {
        setErr(labels.keyUsed);
        return;
      }
      if ((s as Status).error === "key_revoked") {
        setErr(labels.lockedMsg);
        return;
      }
      if ((s as Status).error) {
        setErr(labels.keyInvalid);
        return;
      }
      if (full.activated) {
        if (full.activationKey) setSavedKey(full.activationKey);
        savePrefill();
        enter(labels.successMsg);
      } else {
        setErr(labels.keyInvalid);
      }
    } finally {
      setBusy(null);
    }
  }

  function copyText(v: string, done: (b: boolean) => void) {
    if (!v) return;
    try {
      void navigator.clipboard.writeText(v);
      done(true);
      setTimeout(() => done(false), 1500);
    } catch {
      /* ignore */
    }
  }

  // ── Shared dark-field vocabulary ──────────────────────────────────────────
  const fieldLabel = "mb-1.5 block text-[13px] font-semibold text-white/50";
  const fieldLabelIcon = "mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-white/50";
  const fieldInput =
    "h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3.5 text-[15px] text-white outline-none transition placeholder:text-white/30 focus:border-[#e8ba4c]/70 focus:bg-white/[0.08] disabled:opacity-60";
  const fieldError = "mt-1.5 text-xs font-bold text-rose-300";
  const alertError = "rounded-xl border border-red-400/20 bg-red-500/15 p-2.5 text-sm font-bold text-rose-200";
  const primaryBtn =
    "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e8ba4c] text-base font-black text-[#1c1200] transition hover:bg-[#ffe08a] disabled:opacity-50";
  const ghostBtn =
    "flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/15 px-4 text-xs font-bold text-white/75 transition hover:bg-white/10 hover:text-white";
  const card =
    "rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-6";

  // Phones/tablets skip activation entirely (server gates are UA-scoped):
  // landing here sends them to login instead of a dead-end note.
  useEffect(() => {
    if (mounted && !isDesktop()) router.replace(`/${locale}/login`);
  }, [mounted, router, locale]);

  if (!mounted || !isDesktop()) {
    return null;
  }

  const locked = !!st?.locked || !!st?.revoked;
  const entitled = !!st?.activated || !!st?.inTrial;

  return (
    <main dir={dir} className="relative flex min-h-dvh items-center justify-center overflow-y-auto">
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

      <div className="relative z-10 m-auto w-full max-w-[480px] px-5 py-10 2xl:max-w-[500px]">
        {/* brand */}
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/logo-192.png"
            alt="Golden Wafer"
            className="mb-4 inline-block h-14 w-14 rounded-[18px] 2xl:h-16 2xl:w-16"
            style={{ boxShadow: "0 0 55px -8px rgba(232,186,76,0.6), 0 0 0 1px rgba(232,186,76,0.25)" }}
          />
          <h1 className="text-[1.7rem] font-extrabold leading-none tracking-tight text-white 2xl:text-3xl" dir="ltr">
            <span>GOLDEN</span>
            <span className="text-[#e8ba4c]"> WAFER</span>
          </h1>
          <p className="mt-2 text-sm font-medium text-white/55">{labels.title}</p>
        </div>

        <div className="mb-4 flex justify-center">
          <LanguageSwitcher tone="onDark" />
        </div>

        <div className="space-y-4">
          {/* status hero */}
          {!st ? (
            <div className={`${card} animate-pulse`}>
              <div className="mx-auto h-5 w-40 rounded-full bg-white/10" />
              <div className="mx-auto mt-3 h-3 w-56 rounded-full bg-white/10" />
            </div>
          ) : locked ? (
            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-6 text-center shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white">
                <Lock size={22} />
              </div>
              <p className="text-lg font-black text-rose-200">{labels.lockedTitle}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-white/60">{labels.revoked}</p>
            </div>
          ) : entitled && !okMsg && !savedKey ? (
            <div className="flex items-center gap-4 rounded-2xl border border-[#e8ba4c]/25 bg-[#e8ba4c]/10 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              {st.inTrial ? (
                <TrialRing daysLeft={st.daysLeft} label={labels.daysShort} />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#e8ba4c] text-[#1c1200]">
                  <BadgeCheck size={30} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-base font-black text-white">
                  {st.activated ? labels.activated : labels.trial}
                </p>
                {st.inTrial && (
                  <p className="text-sm text-white/60">
                    {labels.trialLeft.replace("{n}", String(st.daysLeft))}
                  </p>
                )}
                {st.devBypass && <p className="text-xs font-bold text-amber-300">DEV — placeholder key</p>}
                <button
                  onClick={goOnboard}
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#e8ba4c] px-5 py-2 text-sm font-black text-[#1c1200] transition hover:bg-[#ffe08a]"
                >
                  {labels.goOnboard} <span aria-hidden>{dir === "rtl" ? "←" : "→"}</span>
                </button>
              </div>
            </div>
          ) : st.expired ? (
            <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-6 text-center shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white">
                <Hourglass size={22} />
              </div>
              <p className="text-lg font-black text-amber-200">{labels.expiredTitle}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-white/60">{labels.expiredSub}</p>
            </div>
          ) : null}

          {/* success / saved-key celebration */}
          {(okMsg || savedKey) && (
            <div className="rounded-2xl border border-[#e8ba4c]/25 bg-[#e8ba4c]/10 p-6 text-center shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e8ba4c] text-[#1c1200]">
                <Check size={24} strokeWidth={3} />
              </div>
              <p className="text-lg font-black text-white">{okMsg ?? labels.successMsg}</p>
              {savedKey && (
                <div className="mx-auto mt-3 max-w-sm">
                  <p className="mb-1 text-xs font-bold text-white/50">{labels.saveKeyTitle}</p>
                  <div className="flex items-center gap-2">
                    <code dir="ltr" className="flex-1 select-all truncate rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-sm font-black text-white">
                      {savedKey}
                    </code>
                    <button
                      onClick={() => copyText(savedKey, setKeyCopied)}
                      className="flex h-11 shrink-0 items-center gap-1 rounded-xl border border-white/15 px-3 text-xs font-black text-white/80 transition hover:bg-white/10"
                    >
                      {keyCopied ? <Check size={14} /> : <Copy size={14} />} {keyCopied ? labels.copied : labels.copyBtn}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-white/50">{labels.saveKeySub}</p>
                </div>
              )}
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-white/55">
                <Loader2 size={13} className="animate-spin" /> {labels.redirecting}
              </p>
            </div>
          )}

          {!entitled && !locked && !savedKey && (
            <>
              {/* tabs — only when there are two options (web). The desktop
                  shell hides the trial tab, so no tab bar at all there. */}
              {!trialHidden && (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1">
                {(
                  [
                    { id: "trial", label: labels.tabTrial, Icon: Rocket },
                    { id: "activate", label: labels.tabActivate, Icon: KeyRound },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTab(t.id);
                      setErr(null);
                      setTrialError(null);
                    }}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-black transition",
                      tab === t.id ? "bg-[#e8ba4c] text-[#1c1200] shadow" : "text-white/55 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <t.Icon size={16} /> {t.label}
                  </button>
                ))}
              </div>
              )}

              {activeTab === "trial" ? (
                <div className={`${card} space-y-4`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <Store size={16} className="text-white/50" />
                      <h2 className="text-base font-black text-white">{labels.trialTitle}</h2>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-white/50">{labels.trialSub}</p>
                  </div>
                  <div>
                    <label className={fieldLabel}>{labels.shopLabel}</label>
                    <input
                      value={shop}
                      onChange={(e) => setShop(e.target.value)}
                      autoComplete="off"
                      className={fieldInput}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabelIcon}>
                        <User size={12} /> {labels.nameLabel}
                      </label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                        className={fieldInput}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelIcon}>
                        <MapPin size={12} /> {labels.cityLabel}
                      </label>
                      <input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        autoComplete="off"
                        className={fieldInput}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={fieldLabelIcon}>
                      <Phone size={12} /> {labels.phoneLabel}
                    </label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="off"
                      className={cn(
                        fieldInput,
                        "font-mono",
                        phoneError ? "border-red-400/60" : ""
                      )}
                    />
                    {phoneError && <p className={fieldError}>{phoneError}</p>}
                  </div>
                  {trialError && <p role="alert" className={alertError}>{trialError}</p>}
                  <button
                    onClick={() => void startTrial()}
                    disabled={busy === "trial"}
                    className={primaryBtn}
                  >
                    {busy === "trial" ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />}
                    {labels.trialBtn}
                  </button>
                </div>
              ) : (
                <div className={card}>
                  <div className="flex items-center gap-2">
                    <KeyRound size={16} className="text-white/50" />
                    <h2 className="text-base font-black text-white">{labels.tabActivate}</h2>
                  </div>
                    {phase === "waiting" ? (
                      <div className="py-2 text-center">
                        <Loader2 size={32} className="mx-auto animate-spin text-[#e8ba4c]" />
                        <p className="mt-3 text-sm font-black text-white">{labels.waitingTitle}</p>
                        <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-white/55">{labels.waitingSub}</p>
                        <button
                          onClick={() => {
                            if (pollRef.current) clearInterval(pollRef.current);
                            setPhase("idle");
                          }}
                          className={`${ghostBtn} mx-auto mt-3`}
                        >
                          <X size={13} /> {labels.cancelWait}
                        </button>
                        {waitedLong && supportPhone && (
                          <a
                            href={`https://wa.me/${supportPhone}?text=${waText}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mx-auto mt-3 flex min-h-11 max-w-xs items-center justify-center gap-2 rounded-xl bg-[#a67812] px-4 text-sm font-black text-white transition hover:brightness-110"
                          >
                            <MessageCircle size={17} /> {labels.whatsappBtn}
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 space-y-4">
                        <div>
                          <label className={fieldLabel}>{labels.shopLabel}</label>
                          <input
                            value={shop}
                            onChange={(e) => setShop(e.target.value)}
                            autoComplete="off"
                            maxLength={80}
                            className={fieldInput}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={fieldLabel}>{labels.nameLabel}</label>
                            <input
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              autoComplete="off"
                              maxLength={80}
                              className={fieldInput}
                            />
                          </div>
                          <div>
                            <label className={fieldLabel}>{labels.cityLabel}</label>
                            <input
                              value={city}
                              onChange={(e) => setCity(e.target.value)}
                              autoComplete="off"
                              maxLength={80}
                              className={fieldInput}
                            />
                          </div>
                        </div>
                        <div>
                          <label className={fieldLabel}>{labels.phoneLabel}</label>
                          <input
                            value={checkPhone}
                            onChange={(e) => setCheckPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                            dir="ltr"
                            inputMode="numeric"
                            autoComplete="off"
                            className={cn(fieldInput, "font-mono", checkPhoneError ? "border-red-400/60" : "")}
                          />
                          {checkPhoneError && <p className={fieldError}>{checkPhoneError}</p>}
                        </div>
                        <div>
                          <label className={fieldLabel}>{labels.emailLabel}</label>
                          <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            type="email"
                            dir="ltr"
                            autoComplete="off"
                            maxLength={254}
                            className={fieldInput}
                          />
                        </div>
                        <div>
                          <label className={fieldLabel}>{labels.key}</label>
                          <input
                            value={shortKey}
                            onChange={(e) => setShortKey(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, "").slice(0, 29))}
                            dir="ltr"
                            autoComplete="off"
                            className={cn(fieldInput, "font-mono font-black tracking-wider")}
                          />
                        </div>
                        {err && <p role="alert" className={alertError}>{err}</p>}
                        <button
                          onClick={() => void submitActivation()}
                          disabled={busy !== null}
                          className={primaryBtn}
                        >
                          {busy !== null ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                          {labels.redeem}
                        </button>
                      </div>
                    )}
                </div>
              )}
            </>
          )}

          {/* machine id */}
          {machineId && (
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-xl">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-white/40">{labels.machine}</p>
                <p className="truncate font-mono text-xs font-bold text-white/90" dir="ltr">
                  {machineId}
                </p>
              </div>
              <button
                onClick={() => copyText(machineId, setIdCopied)}
                className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-white/15 px-2.5 text-xs font-black text-white/75 transition hover:bg-white/10"
              >
                {idCopied ? <Check size={13} /> : <Copy size={13} />} {idCopied ? labels.copied : labels.copyBtn}
              </button>
            </div>
          )}

          {supportPhone && activeTab === "trial" && !entitled && (
            <a
              href={`https://wa.me/${supportPhone}?text=${waText}`}
              target="_blank"
              rel="noreferrer"
              className="mx-auto flex min-h-11 w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 text-xs font-black text-white/70 backdrop-blur-xl transition hover:bg-white/10 hover:text-white"
            >
              <MessageCircle size={15} className="text-[#a67812]" /> {labels.whatsappBtn}
            </a>
          )}
        </div>

        {/* footer */}
        <p className="mt-5 text-center text-xs text-white/35" dir="ltr">
          Golden Wafer · v{pkg.version}
        </p>
      </div>
    </main>
  );
}
