"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/Toggle";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsPanel, SettingsCard, SettingRow, useSectionText } from "@/components/settings/SettingsPanel";
import { api, type Settings } from "@/components/settings/api";

const HINTS: Record<string, string> = {
  debtTrackingEnabled: "debtHint",
  transferConfirmRequired: "transferConfirmHint",
  qrStrictMode: "qrHint",
  gpsEnabled: "gpsHint",
  supplierFilterEnabled: "supplierFilterHint",
} as const;

/// Client-visible toggles only. The business-model toggles (expiry, credit
/// sales, remise, deposits, multi-depot, facture pro, POS, oversell, piece
/// sales) plus costing/van-binding are VENDOR-controlled (hidden UI + API).
const BOOL_TOGGLES = [
  "debtTrackingEnabled",
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
      <SettingsCard title={t("sales")} description={description}>
        {BOOL_TOGGLES.map((key) => (
          <SettingRow key={key} label={t(key)} description={t(HINTS[key])}>
            <div className="flex sm:justify-end">
              <Switch checked={Boolean(settings[key])} onChange={(v) => patch({ [key]: v })} label={t(key)} />
            </div>
          </SettingRow>
        ))}
        {/* Expected van departure time (late-start flags on presence) */}
        <SettingRow label={t("workStart")} description={t("workStartHint")}>
          <input
            type="time"
            value={String(settings.workStartAt ?? "")}
            onChange={(e) => patch({ workStartAt: e.target.value || null })}
            dir="ltr"
            className="h-11 w-full rounded-[11px] border border-(--border-default) bg-(--bg-surface) px-3 text-sm font-semibold tabular-nums outline-none focus:border-(--brand-500)"
          />
        </SettingRow>
        {/* Max journée length (overtime flags on presence) */}
        <SettingRow label={t("maxDayHours")} description={t("maxDayHoursHint")}>
          <input
            type="number" min={1} max={24} step={0.5}
            value={String(settings.maxDayHours ?? "")}
            onChange={(e) => patch({ maxDayHours: e.target.value === "" ? null : Number(e.target.value) })}
            dir="ltr"
            className="h-11 w-full rounded-[11px] border border-(--border-default) bg-(--bg-surface) px-3 text-sm font-semibold tabular-nums outline-none focus:border-(--brand-500)"
          />
        </SettingRow>
        {/* Thermal ticket language (Arabic RTL / French LTR) */}
        <SettingRow label={t("ticketLang")} description={t("ticketLangHint")}>
          <SegmentedControl
            value={String(settings.ticketLang ?? "fr") as "ar" | "fr"}
            onChange={(l) => patch({ ticketLang: l })}
            ariaLabel={t("ticketLang")}
            options={[{ value: "ar", label: "عربي" }, { value: "fr", label: "Français" }]}
          />
        </SettingRow>
        {/* Thermal ticket paper width (58mm / 80mm) */}
        <SettingRow label={t("ticketWidth")} description={t("ticketWidthHint")}>
          <SegmentedControl
            value={String(settings.ticketWidth ?? "80") as "58" | "80"}
            onChange={(w) => patch({ ticketWidth: w })}
            ariaLabel={t("ticketWidth")}
            options={[{ value: "58", label: "58mm" }, { value: "80", label: "80mm" }]}
          />
        </SettingRow>
      </SettingsCard>
    </SettingsPanel>
  );
}
