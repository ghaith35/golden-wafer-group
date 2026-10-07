"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ShieldCheck,
  Store,
  User,
  MapPin,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  licenseRegister?: (label?: string, phone?: string) => Promise<Status>;
  licenseStartTrial: (info: Record<string, string>) => Promise<Status>;
  licenseCheck: () => Promise<Status>;
  licenseRedeemKey: (key: string, label?: string) => Promise<Status>;
};

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { distribuili?: Bridge };
  return w.distribuili ?? null;
}

const isDesktop = () => bridge() !== null;

/// Algerian mobile only (mirrors server validDzPhone): 05/06/07 + 8 digits.
const DZ_PHONE = /^0[567]\d{8}$/;

const LANGS = [
  { code: "ar", short: "ع" },
  { code: "fr", short: "FR" },
  { code: "en", short: "EN" },
] as const;

const TRIAL_DAYS = 14;

function TrialRing({ daysLeft, label }: { daysLeft: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, daysLeft / TRIAL_DAYS));
  return (
    <div className="relative h-24 w-24">
      <svg viewBox="0 0 84 84" className="h-24 w-24 -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="8" className="stroke-(--border-default)" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className="stroke-amber-500 transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-(--text-primary) tabular-nums" dir="ltr">
          {daysLeft}
        </span>
        <span className="text-[10px] font-bold uppercase opacity-60">{label}</span>
      </div>
    </div>
  );
}

export function ActivateClient({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const [st, setSt] = useState<Status | null>(null);
  const [tab, setTab] = useState<"trial" | "activate">("trial");
  const [busy, setBusy] = useState<"trial" | "check" | "key" | null>(null);
  const [phase, setPhase] = useState<"idle" | "waiting">("idle");
  const [waitedLong, setWaitedLong] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [shop, setShop] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [city, setCity] = useState("");
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
      if (s.activated || s.inTrial) enter(labels.trialOk);
      else setTrialError(labels.genericError);
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
      await b.licenseRegister?.(shop.trim() || undefined, checkPhone.trim())?.catch(() => {});
      const s = await b.licenseCheck();
      const full = await b.licenseStatus().catch(() => s);
      setSt(full);
      if (full.locked || full.revoked) {
        setErr(labels.lockedMsg);
        return;
      }
      if (full.activated || full.inTrial) {
        if (full.activationKey) setSavedKey(full.activationKey);
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

  async function redeemKey() {
    const b = bridge();
    if (!b || !shortKey.trim()) return;
    setBusy("key");
    setErr(null);
    try {
      const s = await b.licenseRedeemKey(shortKey.trim().toUpperCase(), shop.trim() || undefined);
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

  if (!isDesktop()) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-2xl border border-(--border-default) bg-(--bg-overlay) p-5 text-sm text-(--text-primary) shadow-sm">
          {labels.webNote}
        </div>
      </div>
    );
  }

  const locked = !!st?.locked || !!st?.revoked;
  const entitled = !!st?.activated || !!st?.inTrial;

  return (
    <div dir={dir} className="relative min-h-svh overflow-hidden bg-(--bg-surface)">
      {/* ambient hero glow */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72" style={{ background: "var(--gradient-brand)", opacity: 0.16 }} />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 start-1/4 h-64 w-64 rounded-full blur-3xl"
        style={{ background: "var(--gradient-brand)", opacity: 0.25 }}
      />

      <div className="relative mx-auto w-full max-w-lg space-y-4 px-4 py-6 sm:py-10">
        {/* language switcher */}
        <div className="flex justify-end">
          <div className="flex gap-1 rounded-xl bg-(--bg-sunken) p-1">
            {LANGS.map((l) => (
              <a
                key={l.code}
                href={`/${l.code}/activate`}
                className={cn(
                  "min-h-8 rounded-lg px-2.5 py-1 text-xs font-black",
                  locale === l.code ? "bg-(--brand-500) text-white" : "opacity-60 hover:opacity-100"
                )}
              >
                {l.short}
              </a>
            ))}
          </div>
        </div>

        {/* brand */}
        <div className="text-center">
          <div
            className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-3xl text-3xl font-black text-white shadow-lg"
            style={{ background: "var(--gradient-brand)" }}
          >
            D
          </div>
          <h1 className="text-2xl font-black tracking-tight text-(--text-primary)">DISTRIBUILI</h1>
          <p className="mt-1 text-sm font-medium text-(--text-secondary)">{labels.title}</p>
        </div>

        {/* status hero */}
        {!st ? (
          <div className="animate-pulse rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-6 shadow-sm">
            <div className="mx-auto h-5 w-40 rounded-full bg-(--bg-sunken)" />
            <div className="mx-auto mt-3 h-3 w-56 rounded-full bg-(--bg-sunken)" />
          </div>
        ) : locked ? (
          <div className="rounded-3xl border border-red-500/40 bg-red-500/10 p-6 text-center shadow-sm">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white">
              <Lock size={22} />
            </div>
            <p className="text-lg font-black text-red-500">{labels.lockedTitle}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-(--text-secondary)">{labels.revoked}</p>
          </div>
        ) : entitled && !okMsg && !savedKey ? (
          <div className="flex items-center gap-4 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-sm">
            {st.inTrial ? (
              <TrialRing daysLeft={st.daysLeft} label={labels.daysShort} />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white">
                <BadgeCheck size={30} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-base font-black text-(--text-primary)">
                {st.activated ? labels.activated : labels.trial}
              </p>
              {st.inTrial && (
                <p className="text-sm text-(--text-secondary)">
                  {labels.trialLeft.replace("{n}", String(st.daysLeft))}
                </p>
              )}
              {st.devBypass && <p className="text-xs font-bold text-amber-600">DEV — placeholder key</p>}
              <button
                onClick={goOnboard}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-black text-white"
                style={{ background: "var(--gradient-brand)" }}
              >
                {labels.goOnboard} <span aria-hidden>{dir === "rtl" ? "←" : "→"}</span>
              </button>
            </div>
          </div>
        ) : st.expired ? (
          <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-6 text-center shadow-sm">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white">
              <Hourglass size={22} />
            </div>
            <p className="text-lg font-black text-amber-600">{labels.expiredTitle}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-(--text-secondary)">{labels.expiredSub}</p>
          </div>
        ) : null}

        {/* success / saved-key celebration */}
        {(okMsg || savedKey) && (
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center shadow-sm">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white">
              <Check size={24} strokeWidth={3} />
            </div>
            <p className="text-lg font-black text-(--text-primary)">{okMsg ?? labels.successMsg}</p>
            {savedKey && (
              <div className="mx-auto mt-3 max-w-sm">
                <p className="mb-1 text-xs font-bold uppercase opacity-60">{labels.saveKeyTitle}</p>
                <div className="flex items-center gap-2">
                  <code dir="ltr" className="flex-1 select-all truncate rounded-xl bg-(--bg-overlay) px-3 py-2.5 font-mono text-sm font-black">
                    {savedKey}
                  </code>
                  <button
                    onClick={() => copyText(savedKey, setKeyCopied)}
                    className="flex h-11 shrink-0 items-center gap-1 rounded-xl border border-(--border-default) px-3 text-xs font-black text-(--text-primary)"
                  >
                    {keyCopied ? <Check size={14} /> : <Copy size={14} />} {keyCopied ? labels.copied : labels.copyBtn}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-(--text-secondary)">{labels.saveKeySub}</p>
              </div>
            )}
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-(--text-secondary)">
              <Loader2 size={13} className="animate-spin" /> {labels.redirecting}
            </p>
          </div>
        )}

        {!entitled && !locked && !savedKey && (
          <>
            {/* tabs */}
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-(--bg-sunken) p-1.5">
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
                    "flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-black transition",
                    tab === t.id ? "bg-(--bg-overlay) text-(--text-primary) shadow-sm" : "opacity-60 hover:opacity-100"
                  )}
                >
                  <t.Icon size={16} /> {t.label}
                </button>
              ))}
            </div>

            {tab === "trial" ? (
              <div className="space-y-3 rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Store size={16} className="opacity-60" />
                  <h2 className="text-base font-black text-(--text-primary)">{labels.trialTitle}</h2>
                </div>
                <p className="-mt-1 text-xs text-(--text-secondary)">{labels.trialSub}</p>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.shopLabel}</label>
                  <input
                    value={shop}
                    onChange={(e) => setShop(e.target.value)}
                    placeholder={labels.shopPh}
                    className="min-h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) px-3 text-sm text-(--text-primary) outline-none focus:border-(--brand-500)"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-bold uppercase opacity-60">
                      <User size={11} /> {labels.nameLabel}
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={labels.namePh}
                      className="min-h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) px-3 text-sm text-(--text-primary) outline-none focus:border-(--brand-500)"
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-bold uppercase opacity-60">
                      <MapPin size={11} /> {labels.cityLabel}
                    </label>
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder={labels.cityPh}
                      className="min-h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) px-3 text-sm text-(--text-primary) outline-none focus:border-(--brand-500)"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-bold uppercase opacity-60">
                    <Phone size={11} /> {labels.phoneLabel}
                  </label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="05 / 06 / 07 …"
                    dir="ltr"
                    inputMode="numeric"
                    className={cn(
                      "min-h-11 w-full rounded-xl border bg-(--bg-surface) px-3 font-mono text-sm text-(--text-primary) outline-none focus:border-(--brand-500)",
                      phoneError ? "border-red-500" : "border-(--border-default)"
                    )}
                  />
                  {phoneError && <p className="mt-1 text-xs font-bold text-red-500">{phoneError}</p>}
                </div>
                {trialError && (
                  <p className="rounded-xl bg-red-500/10 p-2.5 text-sm font-bold text-red-500">{trialError}</p>
                )}
                <button
                  onClick={() => void startTrial()}
                  disabled={busy === "trial"}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-black text-white transition hover:brightness-110 disabled:opacity-50"
                  style={{ background: "var(--gradient-brand)" }}
                >
                  {busy === "trial" ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />}
                  {labels.trialBtn}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-3 rounded-3xl border border-(--border-default) bg-(--bg-overlay) p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="opacity-60" />
                    <h2 className="text-base font-black text-(--text-primary)">{labels.checkTitle}</h2>
                  </div>
                  {phase === "waiting" ? (
                    <div className="py-2 text-center">
                      <Loader2 size={32} className="mx-auto animate-spin text-(--brand-500)" />
                      <p className="mt-3 text-sm font-black text-(--text-primary)">{labels.waitingTitle}</p>
                      <p className="mx-auto mt-1 max-w-xs text-xs text-(--text-secondary)">{labels.waitingSub}</p>
                      <button
                        onClick={() => {
                          if (pollRef.current) clearInterval(pollRef.current);
                          setPhase("idle");
                        }}
                        className="mx-auto mt-3 flex min-h-9 items-center gap-1 rounded-lg border border-(--border-default) px-3 text-xs font-bold text-(--text-secondary)"
                      >
                        <X size={13} /> {labels.cancelWait}
                      </button>
                      {waitedLong && supportPhone && (
                        <a
                          href={`https://wa.me/${supportPhone}?text=${waText}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mx-auto mt-3 flex min-h-11 max-w-xs items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 text-sm font-black text-white"
                        >
                          <MessageCircle size={17} /> {labels.whatsappBtn}
                        </a>
                      )}
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.phoneLabel}</label>
                        <input
                          value={checkPhone}
                          onChange={(e) => setCheckPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                          placeholder="05 / 06 / 07 …"
                          dir="ltr"
                          inputMode="numeric"
                          className={cn(
                            "min-h-11 w-full rounded-xl border bg-(--bg-surface) px-3 font-mono text-sm text-(--text-primary) outline-none focus:border-(--brand-500)",
                            checkPhoneError ? "border-red-500" : "border-(--border-default)"
                          )}
                        />
                        {checkPhoneError && <p className="mt-1 text-xs font-bold text-red-500">{checkPhoneError}</p>}
                      </div>
                      {err && <p className="rounded-xl bg-red-500/10 p-2.5 text-sm font-bold text-red-500">{err}</p>}
                      <button
                        onClick={() => void checkActivation()}
                        disabled={busy === "check"}
                        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-(--brand-500) text-base font-black text-white transition hover:brightness-110 disabled:opacity-50"
                      >
                        {busy === "check" ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                        {labels.check}
                      </button>
                    </>
                  )}
                </div>

                <div className="space-y-3 rounded-3xl border border-dashed border-(--border-default) bg-(--bg-overlay) p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <KeyRound size={16} className="opacity-60" />
                    <h2 className="text-base font-black text-(--text-primary)">{labels.key}</h2>
                  </div>
                  <input
                    value={shortKey}
                    onChange={(e) => setShortKey(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, "").slice(0, 29))}
                    placeholder={labels.keyPh}
                    dir="ltr"
                    className="min-h-11 w-full rounded-xl border border-(--border-default) bg-(--bg-surface) px-3 font-mono text-sm font-black tracking-wider text-(--text-primary) outline-none focus:border-(--brand-500)"
                  />
                  <button
                    onClick={() => void redeemKey()}
                    disabled={busy === "key" || !shortKey.trim()}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-(--brand-500)/50 px-4 text-sm font-black text-(--brand-600) transition hover:bg-(--brand-500)/10 disabled:opacity-50"
                  >
                    {busy === "key" ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                    {labels.redeem}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* machine id */}
        {machineId && (
          <div className="flex items-center gap-2 rounded-2xl border border-(--border-default) bg-(--bg-overlay) px-4 py-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-wider opacity-50">{labels.machine}</p>
              <p className="truncate font-mono text-xs font-bold text-(--text-primary)" dir="ltr">
                {machineId}
              </p>
            </div>
            <button
              onClick={() => copyText(machineId, setIdCopied)}
              className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-(--border-default) px-2.5 text-xs font-black text-(--text-secondary)"
            >
              {idCopied ? <Check size={13} /> : <Copy size={13} />} {idCopied ? labels.copied : labels.copyBtn}
            </button>
          </div>
        )}

        {supportPhone && tab === "trial" && !entitled && (
          <a
            href={`https://wa.me/${supportPhone}?text=${waText}`}
            target="_blank"
            rel="noreferrer"
            className="mx-auto flex min-h-11 w-fit items-center gap-2 rounded-full border border-(--border-default) bg-(--bg-overlay) px-4 text-xs font-black text-(--text-secondary) shadow-sm"
          >
            <MessageCircle size={15} className="text-[#25D366]" /> {labels.whatsappBtn}
          </a>
        )}
      </div>
    </div>
  );
}
