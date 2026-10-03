"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Eye, EyeOff, QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
  const [scanSupported, setScanSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function redirectAfterLogin(role?: string) {
    // Livreur lands straight on the Journée picker (no dashboard detour).
    if (role === "Livreur") {
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
        setError(t("networkError"));
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
      redirectAfterLogin(d?.user?.role);
    } finally {
      setLoading(false);
    }
  }

  // Camera QR scan via the native BarcodeDetector (no extra dependency).
  // Stops automatically after a successful login.
  useEffect(() => {
    setScanSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    if (!BD) {
      setScanning(false);
      return;
    }
    const detector = new BD({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        if (!stopped) {
          setError(t("error"));
          setScanning(false);
        }
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0 && codes[0].rawValue) {
            const ok = await loginWithQr(codes[0].rawValue);
            if (ok) {
              setScanning(false);
              return;
            }
          }
        } catch { /* keep scanning */ }
        raf = window.setTimeout(() => tick(), 400);
      };
      tick();
    })();
    return () => {
      stopped = true;
      window.clearTimeout(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const labelCls = dark
    ? "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60"
    : "mb-1 block text-xs font-semibold uppercase tracking-wide opacity-70";
  const inputCls = dark
    ? "bg-white/10 border-white/15 text-white caret-white placeholder:text-white/35 focus:border-lime-400 focus:bg-white/10 focus:text-white"
    : undefined;
  const tabCls = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
      active
        ? dark
          ? "bg-lime-400 text-black"
          : "bg-(--brand-500)/10 text-(--brand-600)"
        : dark
          ? "text-white/60 hover:bg-white/10"
          : "opacity-60 hover:bg-(--bg-sunken)"
    }`;

  return (
    <div className="space-y-4">
      <div className={`flex gap-1 rounded-xl p-1 ${dark ? "bg-white/5" : "bg-(--bg-sunken)"}`}>
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
        <form onSubmit={onSubmit} className="auth-dark space-y-4">
          <div>
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
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? `${t("submit")}…` : t("submit")}
          </Button>
        </form>
      ) : (
        <div className="auth-dark space-y-3">
          <p className={`text-xs ${dark ? "text-white/60" : "opacity-60"}`}>{t("qrHint")}</p>
          {scanning ? (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
              <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline />
            </div>
          ) : (
            <video ref={videoRef} className="hidden" muted playsInline />
          )}
          {scanSupported && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => setScanning((s) => !s)}
              disabled={loading}
            >
              {scanning ? t("scanStop") : t("scanStart")}
            </Button>
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
          <Button type="button" className="w-full" disabled={loading || !qrInput.trim()} onClick={() => void loginWithQr(qrInput)}>
            {loading ? `${t("qrLogin")}…` : t("qrLogin")}
          </Button>
        </div>
      )}
    </div>
  );
}
