"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ErrText } from "@/components/ui/ErrText";
import { getOfflineCred, hasOfflineUnlock, markOfflineUnlocked, saveOfflineCred, tryOfflineUnlock } from "@/lib/sync/client";

export function LoginForm({ dark = false, canReset = false }: { dark?: boolean; canReset?: boolean }) {
  const t = useTranslations("login");
  const params = useParams();
  const locale = String(params.locale ?? "ar");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Forgot password → activation-key reset (desktop installs only).
  const [resetOpen, setResetOpen] = useState(false);
  const [rKey, setRKey] = useState("");
  const [rUser, setRUser] = useState("");
  const [rPw, setRPw] = useState("");
  const [rPw2, setRPw2] = useState("");
  const [rErr, setRErr] = useState<string | null>(null);
  const [rBusy, setRBusy] = useState(false);
  const [rDone, setRDone] = useState(false);
  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (rBusy) return;
    setRErr(null);
    if (rPw !== rPw2) { setRErr("passwords_mismatch"); return; }
    setRBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: rKey, newPassword: rPw, username: rUser }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setRErr(d?.error ?? "failed"); return; }
      setUsername(d?.username ?? rUser);
      setPassword("");
      setRDone(true);
    } catch {
      setRErr("failed");
    } finally {
      setRBusy(false);
    }
  }
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
  // Offline with a saved unlock session: go straight into the journée. The service
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
    // Livreur + Vendeur land straight on the van flow (no dashboard detour —
    // the Vendeur must never see the admin dashboard, exactly like Livreur).
    if (role === "Livreur" || role === "Vendeur") {
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
      // Online: land on today's start screen (day picker when allowed) — even
      // if a journée is already open, so the driver always sees it after login.
      const t = new Date();
      window.location.assign(`/${locale}/livreur/${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}/start`);
      return;
    }
    const from = new URLSearchParams(window.location.search).get("from");
    const safeFrom = from && from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard";
    window.location.assign(`/${locale}${safeFrom}`);
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
        if (res.status >= 500) throw new Error("server_unreachable");
      } catch {
        // No connection: fall back to the on-device credential cache from
        // the first online login (5-tries lockout inside).
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

  const labelCls = dark
    ? "mb-1.5 block text-[13px] font-semibold text-white/50"
    : "mb-1 block text-xs font-semibold uppercase tracking-wide opacity-70";
  const inputCls = dark
    ? "h-12 rounded-lg border-white/10 bg-white/[0.06] text-white caret-white placeholder:text-white/30 focus:border-[#e8ba4c]/70 focus:bg-white/[0.08] focus:text-white"
    : undefined;
  const primaryDark = "h-12 w-full bg-[#e8ba4c] text-base font-bold text-[#1c1200] hover:bg-[#ffe08a] hover:opacity-100";

  return (
    <div className="space-y-4">
      {offline && (
        <p className="rounded-xl bg-amber-500/10 p-2.5 text-center text-xs font-black text-amber-600" dir="auto">
          📴 {t("offlineMode")}
        </p>
      )}
      {(
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
          {canReset && (
            <button
              type="button"
              onClick={() => { setResetOpen(true); setRDone(false); setRErr(null); }}
              className={`w-full text-center text-xs font-bold underline-offset-4 hover:underline ${dark ? "text-white/60 hover:text-white" : "text-(--brand-600)"}`}
            >
              {t("forgot")}
            </button>
          )}
        </form>
      )}
      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title={t("resetTitle")} width="md" icon="🔑">
        {rDone ? (
          <div className="space-y-3 text-sm">
            <p className="rounded-lg bg-emerald-500/10 p-3 font-bold text-emerald-700">{t("resetDone")}</p>
            <Button type="button" className="w-full" onClick={() => setResetOpen(false)}>{t("resetClose")}</Button>
          </div>
        ) : (
          <form onSubmit={submitReset} className="space-y-3 text-sm">
            <p className="text-xs leading-5 text-(--text-secondary)">{t("resetHint")}</p>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{t("activationKey")}</label>
              <Input value={rKey} onChange={(e) => setRKey(e.target.value)} dir="ltr" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" className="font-mono" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{t("username")}</label>
              <Input value={rUser} onChange={(e) => setRUser(e.target.value)} dir="ltr" autoCapitalize="off" autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{t("newPassword")}</label>
              <Input type="password" value={rPw} onChange={(e) => setRPw(e.target.value)} dir="ltr" autoComplete="new-password" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{t("confirmPassword")}</label>
              <Input type="password" value={rPw2} onChange={(e) => setRPw2(e.target.value)} dir="ltr" autoComplete="new-password" />
            </div>
            {rErr && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500"><ErrText code={rErr} /></p>}
            <Button type="submit" className="w-full" disabled={rBusy || !rKey.trim() || !rPw}>
              {rBusy ? "…" : t("resetSubmit")}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
