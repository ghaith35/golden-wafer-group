"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

export function SuperAdminLogin({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      router.push(`/${locale}/superadmin/dashboard`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-sm flex-col items-center justify-center p-5">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-(--brand-500)/10 text-(--brand-600)">
        <ShieldCheck size={26} />
      </span>
      <h1 className="mb-1 text-xl font-black">{labels.title}</h1>
      <p className="mb-4 text-xs opacity-60">{labels.subtitle}</p>
      <Card>
        <div className="space-y-2">
          <Input placeholder={labels.username} value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoComplete="username" />
          <Input
            type="password" placeholder={labels.password} value={password}
            onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          />
          {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{labels[error] ?? error}</p>}
          <Button onClick={() => void submit()} disabled={busy} className="h-12 w-full">
            {busy ? "…" : labels.login}
          </Button>
        </div>
      </Card>
    </div>
  );
}
