"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Eye, EyeOff, QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QrScanner } from "@/components/scan/QrScanner";
import { getOfflineCred, hasOfflineUnlock, markOfflineUnlocked, saveOfflineCred, saveOfflineQr, tryOfflineUnlock, tryOfflineQrUnlock } from "@/lib/sync/client";

export function LoginForm({ dark = false }: { dark?: boolean }) {
  const t = useTranslations("login");
  const params = useParams();
  const locale = String(params.locale ?? "ar");
  const [tab, setTab] = useState<"pw" | "qr">("pw");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [qrInput, setQrInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /// Offline unlock: no connection but a cached credential from the first
  /// online login exists — verify on-device instead of the server.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const on = () => {
      try { setOffline(false); } catch { /* ignore */ }
    };
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("online", on);
    };
  }, []);

  // If a previous session cached credentials, offer the username immediately.
  // Offline with a valid unlock session (opened within the credential
  // lifetime): skip the form and go straight into the journée — the service
  // worker serves the cached pages, snapshot + outbox keep everything working.
  useEffect(() => {
    try {
      const c = getOfflineCred();
      if (c && !username) setUsername(c.username);
      if (typeof window !== "undefined" && navigator.onLine === false && hasOfflineUnlock()) {
        redirectAfterLogin(c?.role);
      }
    } catch { /* no cache */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function redirectAfterLogin(role?: string) {
    // Livreur lands straight on the Journée picker (no dashboard detour).
    if (role === "Livreur") {
      // Offline: /livreur is an uncached server redirect (dead end without
      // connection) — enter today's cached dashboard directly instead.
      try {
        if (typeof window !== "undefined" && window.navigator?.onLine === false) {
          const d = new Date();
          window.location.assign(`/${locale}/livreur/${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}/dashboard`);
          return;
        }
      } catch {
        /* fall through to the default entry */
      }
      window.location.assign(`/${locale}/livreur`);
      return;
    }
    const from = new URLSearchParams(window.location.search).get("from");
    const safeFrom = from && from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard";
    window.location.assign(`/${locale}${safeFrom}`);
  }

  async function loginWithQr(token: string): Promise<boolean> {
    const trimmed = token.trim();
    if (!trimmed || loading) return false;
    setLoading(true);
    setError(null);
    try {
      let res: Response;
      try {
        res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ qrToken: trimmed }),
        });
      } catch {
        setError(t("networkError"));
        return false;
      }
      if (res.status === 401) {
        setError(t("invalidError"));
        return false;
      }
      if (!res.ok) {
        setError(t("error"));
        return false;
      }
      const d = await res.json().catch(() => null);
      // QR login also opens the offline session (reopening the app
      // offline within the credential lifetime goes straight in) AND caches
      // the badge itself — drivers who never type a password unlock later
      // by scanning again, with zero connection.
      try {
        markOfflineUnlocked();
        saveOfflineQr(trimmed, d?.user?.username ?? "", d?.user?.role ?? "");
      } catch { /* offline cache is best-effort */ }
      redirectAfterLogin(d?.user?.role);
      return true;
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const trimmedUsername = username.trim();
      let res: Response;
      try {
        res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ username: trimmedUsername, password }),
        });
      } catch {
        // No connection: fall back to the on-device credential cache from
        // the first online login (30-day TTL, 5-tries lockout inside).
        const r = tryOfflineUnlock(trimmedUsername, password);
        if (r.ok) {
          const c = getOfflineCred();
          setOffline(true);
          redirectAfterLogin(c?.role);
          return;
        }
        if (r.error === "locked") {
          setError(t("lockedOut"));
          return;
        }
        if (r.error === "no_cache") {
          setOffline(true);
          setError(t("connectOnce"));
          return;
        }
        setError(t("invalidError"));
        return;
      }
      if (res.status === 401) {
        setError(t("invalidError"));
        return;
      }
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.json()).error as string;
        } catch { /* no body */ }
        setError(detail ? `${t("error")}: ${detail}` : t("error"));
        return;
      }
      // Full navigation (not router.push + router.refresh): the auth cookie is
      // HttpOnly and was just set by the API response. A hard navigation
      // guarantees the next request carries it, so the proxy lets the user
      // into the dashboard instead of bouncing back to /login (which looked
      // like "login does nothing").
      // `from` is set by the proxy (?from=/dashboard). Read it from the URL
      // directly so this component doesn't need a Suspense boundary.
      const d = await res.json().catch(() => null);
      // Cache the credential for future offline logins (staff only inside).
      // A fresh login also opens the offline session at once, so the
      // driver isn't asked for the password again on next offline open —
      // and settles any deferred offline logout (this session is truth).
      try {
        saveOfflineCred(trimmedUsername, password, d?.user?.role ?? "");
        markOfflineUnlocked();
        localStorage.removeItem("dili_logout_pending");
      } catch { /* offline cache is best-effort */ }
      redirectAfterLogin(d?.user?.role);
    } finally {
      setLoading(false);
    }
  }

  // Camera QR scan via the shared QrScanner (native BarcodeDetector with
  // jsQR fallback + frozen-preview watchdog). Stops after a successful login.
  // Offline the scanned badge unlocks against the cached mapping from the
  // last online QR login — no connection, no typing.
  async function onScanDetect(text: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const r = tryOfflineQrUnlock(text);
        if (r.ok) {
          setScanning(false);
          setError(null);
          redirectAfterLogin(r.role);
        } else if (r.error === "no_cache") {
          setError(t("connectOnce"));
          setScanning(false);
        } else {
          setError(t("invalidError"));
          setScanning(false);
        }
        return;
      }
    } catch { /* fall through to the online path */ }
    const ok = await loginWithQr(text);
    if (ok) setScanning(false);
  }

  const labelCls = dark
    ? "mb-1.5 block text-[13px] font-semibold text-white/50"
    : "mb-1 block text-xs font-semibold uppercase tracking-wide opacity-70";
  const inputCls = dark
    ? "h-12 rounded-lg border-white/10 bg-white/[0.06] text-white caret-white placeholder:text-white/30 focus:border-[#b5dc63]/70 focus:bg-white/[0.08] focus:text-white"
    : undefined;
  const tabCls = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
      active
        ? dark
          ? "bg-[#b5dc63] text-[#17271e]"
          : "bg-(--brand-500)/10 text-(--brand-600)"
        : dark
          ? "text-white/55 hover:bg-white/10 hover:text-white"
          : "opacity-60 hover:bg-(--bg-sunken)"
    }`;
  const primaryDark = "h-12 w-full bg-[#b5dc63] text-base font-bold text-[#17271e] hover:bg-[#c8e87f] hover:opacity-100";
  const secondaryDark = "w-full border-white/10 bg-white/10 text-white hover:bg-white/15";

  return (
    <div className="space-y-4">
      {offline && (
        <p className="rounded-xl bg-amber-500/10 p-2.5 text-center text-xs font-black text-amber-600" dir="auto">
          📴 {t("offlineMode")}
        </p>
      )}
      <div className={`flex gap-1 rounded-xl p-1 ${dark ? "bg-black/25" : "bg-(--bg-sunken)"}`}>
        <button type="button" onClick={() => { setTab("pw"); setScanning(false); setError(null); }} className={tabCls(tab === "pw")}>
          {t("tabPassword")}
        </button>
        <button type="button" onClick={() => { setTab("qr"); setError(null); }} className={tabCls(tab === "qr")}>
          <span className="inline-flex items-center gap-1.5">
            <QrCode size={15} />
            {t("tabQr")}
          </span>
        </button>
      </div>

            {tab === "pw" ? (
        <form onSubmit={onSubmit} className="auth-dark space-y-4">          <div>
            <label htmlFor="login-username" className={labelCls}>{t("username")}</label>
            <Input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={loading}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="login-password" className={labelCls}>{t("password")}</label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
                className={`${inputCls ?? ""} pe-11`.trim()}
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                aria-pressed={showPassword}
                title={showPassword ? t("hidePassword") : t("showPassword")}
                onClick={() => setShowPassword((v) => !v)}
                className={`absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1.5 transition ${
                  dark
                    ? "bg-black/25 text-white hover:bg-black/40"
                    : "bg-slate-900/5 text-slate-700 hover:bg-slate-900/10"
                }`}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && <p role="alert" className={`text-sm ${dark ? "text-rose-300" : "text-red-500"}`}>{error}</p>}
          <Button type="submit" className={dark ? primaryDark : "w-full"} disabled={loading}>
            {loading ? `${t("submit")}…` : t("submit")}
          </Button>
        </form>
      ) : (
        // QR badge scan works offline too (camera + bundled decoder, unlock
        // against the cached badge) — no "connect once" wall anymore.
        <div className="auth-dark space-y-3">
          <p className={`text-xs ${dark ? "text-white/60" : "opacity-60"}`}>{t("qrHint")}</p>
          {scanning ? (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
              <QrScanner
                key="login-scan"
                className="h-56 w-full object-cover"
                onDetect={(v) => void onScanDetect(v)}
                onError={() => {
                  setScanError(true);
                  setScanning(false);
                  setError(t("error"));
                }}
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className={dark ? secondaryDark : undefined}
              onClick={() => {
                setScanError(false);
                setError(null);
                setScanning(true);
              }}
              disabled={loading}
            >
              {t("scanStart")}
            </Button>
          )}
          {scanning && (
            <Button
              type="button"
              variant="secondary"
              className={dark ? secondaryDark : undefined}
              onClick={() => setScanning(false)}
              disabled={loading}
            >
              {t("scanStop")}
            </Button>
          )}
          {scanError && (
            <p role="alert" className={`text-xs ${dark ? "text-white/60" : "opacity-60"}`}>{t("scanRetryHint")}</p>
          )}
          <div>
            <label htmlFor="login-qrtoken" className={labelCls}>{t("tabQr")}</label>
            <Input
              id="login-qrtoken"
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder={t("qrTokenPh")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={loading}
              className={inputCls}
              dir="ltr"
            />
          </div>
          {error && <p role="alert" className={`text-sm ${dark ? "text-rose-300" : "text-red-500"}`}>{error}</p>}
          <Button type="button" className={dark ? primaryDark : "w-full"} disabled={loading || !qrInput.trim()} onClick={() => void loginWithQr(qrInput)}>
            {loading ? `${t("qrLogin")}…` : t("qrLogin")}
          </Button>
        </div>
      )}
    </div>
  );
}
