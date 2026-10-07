"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { SettingsPanel, useSectionText } from "@/components/settings/SettingsPanel";
import { api, type Settings } from "@/components/settings/api";

export default function GeneralSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { title, description } = useSectionText("general", "generalDesc");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [domain, setDomain] = useState<string | null>(null);

  useEffect(() => {
    api("/api/settings").then(setSettings).catch(console.error);
  }, []);

  async function patch(patch: Record<string, unknown>) {
    setSettings(await api("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }));
  }

  if (!settings) return <p className="py-6 text-sm opacity-60">{tc("loading")}</p>;

  return (
    <SettingsPanel title={title} description={description}>
      <Card>
        <label className="mb-1 block text-sm font-bold">{t("remoteDomain")}</label>
        <input
          value={domain ?? String(settings.remoteDomain ?? "")}
          onChange={(e) => setDomain(e.target.value)}
          onBlur={() => {
            if (domain !== null && domain !== String(settings.remoteDomain ?? "")) {
              patch({ remoteDomain: domain.trim() || null }).catch(console.error);
            }
            setDomain(null);
          }}
          placeholder="client1.distribuili.khiatadz.com"
          dir="ltr"
          className="h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 font-mono text-sm"
        />
        <p className="mt-1 text-xs opacity-60">{t("remoteDomainHint")}</p>
      </Card>
      <Card>
        <label className="mb-1 block text-sm font-bold">{t("costingMethod")}</label>
        <select
          value={String(settings.costingMethod)}
          onChange={(e) => patch({ costingMethod: e.target.value })}
          className="h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm"
        >
          <option value="FIFO">FIFO</option>
          <option value="LAST">Last</option>
          <option value="AVERAGE">Average</option>
        </select>
        <p className="mt-1 text-xs opacity-60">{t("costingHint")}</p>
      </Card>
      <Card>
        <label className="mb-1 block text-sm font-bold">{t("vanBindingMode")}</label>
        <select
          value={String(settings.vanBindingMode)}
          onChange={(e) => patch({ vanBindingMode: e.target.value })}
          className="h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-2 text-sm"
        >
          <option value="LOCKED">LOCKED</option>
          <option value="PICK">PICK</option>
        </select>
        <p className="mt-1 text-xs opacity-60">{t("vanBindingHint")}</p>
      </Card>
    </SettingsPanel>
  );
}
