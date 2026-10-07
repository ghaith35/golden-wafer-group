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
  supplierFilterEnabled: "supplierFilterHint",
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
  "supplierFilterEnabled",
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
      {/* Thermal ticket language (Arabic RTL / French LTR) */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-(--border-default) px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-bold">{t("ticketLang")}</div>
          <div className="text-xs opacity-60">{t("ticketLangHint")}</div>
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg bg-(--bg-sunken) p-1" dir="ltr">
          {(["ar", "fr"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => patch({ ticketLang: l })}
              className={
                String(settings.ticketLang ?? "fr") === l
                  ? "rounded-md bg-(--brand-500) px-3 py-1 text-xs font-black text-white"
                  : "rounded-md px-3 py-1 text-xs font-bold opacity-60 hover:opacity-100"
              }
            >
              {l === "ar" ? "عربي" : "Français"}
            </button>
          ))}
        </div>
      </div>
      {/* Thermal ticket paper width (58mm / 80mm) */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-(--border-default) px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-bold">{t("ticketWidth")}</div>
          <div className="text-xs opacity-60">{t("ticketWidthHint")}</div>
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg bg-(--bg-sunken) p-1" dir="ltr">
          {(["58", "80"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => patch({ ticketWidth: w })}
              className={
                String(settings.ticketWidth ?? "80") === w
                  ? "rounded-md bg-(--brand-500) px-3 py-1 text-xs font-black text-white"
                  : "rounded-md px-3 py-1 text-xs font-bold opacity-60 hover:opacity-100"
              }
            >
              {w}mm
            </button>
          ))}
        </div>
      </div>
    </SettingsPanel>
  );
}
