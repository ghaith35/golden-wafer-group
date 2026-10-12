"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function SuperAdminLogin({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const router = useRouter();
  const isRtl = locale === "ar";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      if (d?.mustChangePassword) {
        setMustChangePassword(true);
        setPassword("");
        return;
      }
      router.push(`/${locale}/superadmin/licenses`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeInitialPassword() {
    if (busy || newPassword.length < 12 || newPassword !== confirmPassword) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      router.push(`/${locale}/superadmin/licenses`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(180deg, var(--sa-sidebar-start), var(--sa-sidebar-end))" }}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="w-full max-w-sm rounded-xl border border-(--sa-sidebar-footer-border) bg-(--sa-sidebar-hover-bg) p-8 shadow-2xl backdrop-blur-sm">
        <div className="mb-8 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-[14px] bg-gradient-brand text-sm font-black text-(--brand-contrast) shadow-[0_10px_24px_rgba(4,120,87,0.35)]">
            D
          </span>
          <h1 className="mt-3 text-lg font-black text-(--sa-sidebar-fg)">
            {labels.title}
          </h1>
          <p className="mt-1 text-xs font-semibold text-(--sa-sidebar-muted)">
            {labels.subtitle}
          </p>
        </div>

        <div className="space-y-4">
          {mustChangePassword ? (
            <>
              <p className="text-sm font-bold text-(--sa-sidebar-fg)">{labels.passwordRotationRequired}</p>
              <p className="text-xs text-(--sa-sidebar-muted)">{labels.passwordMinimum}</p>
              <Input
                type="password" placeholder={labels.newPassword} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} dir="ltr" autoComplete="new-password"
                className="border-(--sa-sidebar-footer-border) bg-(--sa-sidebar-end) text-(--sa-sidebar-fg) placeholder:text-(--sa-sidebar-muted) focus:bg-(--sa-sidebar-end)"
              />
              <Input
                type="password" placeholder={labels.confirmPassword} value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} dir="ltr" autoComplete="new-password"
                onKeyDown={(e) => { if (e.key === "Enter") void changeInitialPassword(); }}
                className="border-(--sa-sidebar-footer-border) bg-(--sa-sidebar-end) text-(--sa-sidebar-fg) placeholder:text-(--sa-sidebar-muted) focus:bg-(--sa-sidebar-end)"
              />
            </>
          ) : (
            <>
              <Input
                placeholder={labels.username} value={username}
                onChange={(e) => setUsername(e.target.value)} dir="ltr" autoComplete="username"
                className="border-(--sa-sidebar-footer-border) bg-(--sa-sidebar-end) text-(--sa-sidebar-fg) placeholder:text-(--sa-sidebar-muted) focus:bg-(--sa-sidebar-end)"
              />
              <Input
                type="password" placeholder={labels.password} value={password}
                onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                className="border-(--sa-sidebar-footer-border) bg-(--sa-sidebar-end) text-(--sa-sidebar-fg) placeholder:text-(--sa-sidebar-muted) focus:bg-(--sa-sidebar-end)"
              />
            </>
          )}
          {error && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-400">{labels[error] ?? error}</p>}
          <Button
            onClick={() => void (mustChangePassword ? changeInitialPassword() : submit())}
            disabled={busy || (mustChangePassword && (newPassword.length < 12 || newPassword !== confirmPassword))}
            className="h-11 w-full rounded-[11px] text-sm font-black"
          >
            {busy ? "…" : mustChangePassword ? labels.changePassword : labels.login}
          </Button>
        </div>
      </div>
    </div>
  );
}
