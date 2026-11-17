"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ErrText } from "@/components/ui/ErrText";
import { SettingsPanel, SettingsCard } from "@/components/settings/SettingsPanel";

const SCOPES = [
  "clients", "suppliers", "products", "stock", "sales", "orders", "purchases",
  "transfers", "expenses", "cash", "tournees", "staff",
] as const;
type Scope = (typeof SCOPES)[number] | "all";

export default function DataResetPage() {
  const t = useTranslations("resetData");
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [stage, setStage] = useState<1 | 2>(1);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ backup: string | null } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/reset-data", { cache: "no-store" });
    if (res.ok) setCounts((await res.json()).counts);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const countOf = (s: Scope) => (s === "all" ? total : (counts?.[s] ?? 0));

  function open(s: Scope) {
    setScope(s);
    setStage(1);
    setPassword("");
    setError(null);
    setDone(null);
  }

  async function run() {
    if (!scope || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/reset-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, password }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error === "invalid_credentials" ? "wrong_password" : (d?.error ?? "reset_failed"));
        return;
      }
      setDone({ backup: d?.backup ?? null });
      setScope(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPanel title={t("title")} description={t("intro")}>
      {done && (
        <p className="rounded-xl bg-emerald-500/10 p-3 text-sm font-bold text-emerald-700">
          ✓ {t("done")}
          {done.backup ? <span className="mt-1 block text-xs font-semibold opacity-80" dir="ltr">{t("backup", { path: done.backup })}</span> : null}
        </p>
      )}

      <SettingsCard title={t("title")}>
        {SCOPES.map((s) => {
          const n = countOf(s);
          return (
            <div key={s} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black">{t(`scopes.${s}.name`)}</span>
                  <span className="rounded-full bg-(--bg-sunken) px-2 py-0.5 text-[11px] font-black tabular-nums text-(--text-secondary)">
                    {t("records", { n })}
                  </span>
                </div>
                <p className="mt-0.5 max-w-[70ch] text-[11px] font-semibold leading-5 text-(--text-secondary)">{t(`scopes.${s}.desc`)}</p>
              </div>
              <Button variant="secondary" disabled={n === 0} onClick={() => open(s)} className="shrink-0 !text-red-500">
                <Trash2 size={14} className="me-1" />
                {t("reset")}
              </Button>
            </div>
          );
        })}
      </SettingsCard>

      <section className="rounded-[18px] border-2 border-red-500/40 bg-red-500/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <TriangleAlert size={22} className="shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-red-600">{t("scopes.all.name")}</div>
            <p className="mt-0.5 text-[11px] font-semibold leading-5 text-(--text-secondary)">{t("scopes.all.desc")}</p>
          </div>
          <Button variant="destructive" disabled={total === 0} onClick={() => open("all")} className="shrink-0">
            <Trash2 size={14} className="me-1" />
            {t("reset")}
          </Button>
        </div>
      </section>

      <Modal open={scope !== null && stage === 1} onClose={() => setScope(null)} title={t("step1T")} width="sm" icon="⚠️">
        {scope && (
          <div className="space-y-3 text-sm">
            <p className="font-bold">{t("step1Q", { n: countOf(scope), name: t(`scopes.${scope}.name`) })}</p>
            <p className="rounded-lg bg-(--bg-sunken) p-3 text-xs leading-5 text-(--text-secondary)">{t(`scopes.${scope}.desc`)}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setScope(null)}>{t("back")}</Button>
              <Button type="button" onClick={() => setStage(2)}>{t("next")}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={scope !== null && stage === 2} onClose={() => setScope(null)} title={t("step2T")} width="sm" icon="🛑">
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-red-500/10 p-3 font-bold text-red-500">{t("step2M")}</p>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase opacity-60">{t("password")}</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" dir="ltr" />
          </div>
          {error && (
            <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">
              {error === "wrong_password" ? t("wrongPassword") : <ErrText code={error} />}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setScope(null)} disabled={busy}>{t("back")}</Button>
            <Button type="button" variant="destructive" disabled={busy || !password} onClick={() => void run()}>
              {busy ? "…" : t("confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </SettingsPanel>
  );
}
