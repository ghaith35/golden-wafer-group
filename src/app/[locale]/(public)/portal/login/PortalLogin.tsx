"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

import { ErrText } from "@/components/ui/ErrText";
export function PortalLogin({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, secret }),
      });
      if (!res.ok) {
        setError(labels.error);
        return;
      }
      router.push(`/${locale}/portal`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center p-6">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-brand text-xl font-black text-(--brand-contrast)">
          D
        </div>
        <h1 className="text-xl font-bold">{labels.title}</h1>
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase opacity-70">{labels.phone}</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase opacity-70">{labels.secret}</label>
            <Input value={secret} onChange={(e) => setSecret(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-500"><ErrText code={error} /></p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {labels.submit}
          </Button>
        </form>
      </Card>
    </div>
  );
}
