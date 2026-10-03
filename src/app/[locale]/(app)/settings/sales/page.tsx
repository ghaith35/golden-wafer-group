"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@/components/ui/Toggle";
import { SettingsPanel, useSectionText } from "@/components/settings/SettingsPanel";
import { api, type Settings } from "@/components/settings/api";

const HINTS: Record<string, string> = {
  expiryEnabled: "expiryHint",
  creditSalesEnabled: "creditHint",
  debtTrackingEnabled: "debtHint",
  remiseEnabled: "remiseHint",
  depositsEnabled: "depositsHint",
  multiDepotEnabled: "multiDepotHint",
  facturePro: "factureHint",
  posEnabled: "posHint",
  oversellAllowed: "oversellHint",
  pieceSalesEnabled: "pieceSalesHint",
  transferConfirmRequired: "transferConfirmHint",
  qrStrictMode: "qrHint",
  gpsEnabled: "gpsHint",
} as const;

const BOOL_TOGGLES = [
  "expiryEnabled",
  "creditSalesEnabled",
  "debtTrackingEnabled",
  "remiseEnabled",
  "depositsEnabled",
  "multiDepotEnabled",
  "facturePro",
  "posEnabled",
  "oversellAllowed",
  "pieceSalesEnabled",
  "transferConfirmRequired",
  "qrStrictMode",
  "gpsEnabled",
] as const;

export default function SalesSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { title, description } = useSectionText("sales", "salesDesc");
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api("/api/settings").then(setSettings).catch(console.error);
  }, []);

  async function patch(patch: Record<string, unknown>) {
    setSettings(await api("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }));
  }

  if (!settings) return <p className="py-6 text-sm opacity-60">{tc("loading")}</p>;

  return (
    <SettingsPanel title={title} description={description}>
      {BOOL_TOGGLES.map((key) => (
        <Toggle
          key={key}
          checked={Boolean(settings[key])}
          onChange={(v) => patch({ [key]: v })}
          label={t(key)}
          hint={t(HINTS[key])}
        />
      ))}
    </SettingsPanel>
  );
}
