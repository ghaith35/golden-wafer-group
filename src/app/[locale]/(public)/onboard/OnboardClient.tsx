"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

/// First-run wizard: company + owner admin credentials. One-shot (the API
/// refuses once a company exists). Mirrors the login page styling.
export function OnboardClient({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!company.trim() || !fullName.trim() || username.trim().length < 3 || !password) {
      setError("missing_fields");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: company.trim(), fullName: fullName.trim(), username: username.trim(), password }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? "failed");
        return;
      }
      router.push(`/${locale}/login`);
      router.refresh();
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm outline-none focus:border-(--brand-500)";

  return (
    <main className="flex min-h-screen items-center justify-center p-5 md:p-6">
      <Card>
        <h1 className="mb-1 text-xl font-black">{labels.title}</h1>
        <p className="mb-4 text-sm opacity-60">{labels.subtitle}</p>
        {error && <p className="mb-2 rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
        <div className="grid gap-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.company}</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.fullName}</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.username}</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase opacity-60">{labels.password}</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
            </div>
          </div>
          <Button onClick={() => void submit()} disabled={busy} className="mt-1 h-12 w-full text-base">
            {busy ? "…" : labels.submit}
          </Button>
          <button type="button" onClick={() => router.push(`/${locale}/login`)} className="mx-auto block text-xs font-bold opacity-60 underline">
            {labels.loginNow}
          </button>
        </div>
      </Card>
    </main>
  );
}
