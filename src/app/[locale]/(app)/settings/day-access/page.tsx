"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/Toggle";
import { SettingsPanel, SettingsCard, SettingRow, useSectionText } from "@/components/settings/SettingsPanel";
import { api } from "@/components/settings/api";

type Staff = { id: string; fullName: string; username: string; role: string; canChooseDay: boolean };

/// Per-employee switch: ON = may pick the journée day, OFF = locked to today's
/// tour (and only that day's sector + clients).
export default function DayAccessSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { title, description } = useSectionText("dayAccess", "dayAccessDesc");
  const [rows, setRows] = useState<Staff[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/settings/day-access").then(setRows).catch(console.error);
  }, []);

  async function toggle(u: Staff, v: boolean) {
    setError("");
    setRows((r) => r && r.map((x) => (x.id === u.id ? { ...x, canChooseDay: v } : x)));
    try {
      await api("/api/settings/day-access", { method: "PATCH", body: JSON.stringify({ userId: u.id, canChooseDay: v }) });
    } catch {
      setRows((r) => r && r.map((x) => (x.id === u.id ? { ...x, canChooseDay: !v } : x)));
      setError(t("dayAccessError"));
    }
  }

  if (!rows) return <p className="py-6 text-sm opacity-60">{tc("loading")}</p>;

  return (
    <SettingsPanel title={title} description={description}>
      <SettingsCard title={t("dayAccessList")} description={t("dayAccessHint")}>
        {rows.length === 0 && <p className="px-5 py-6 text-sm opacity-60">{t("dayAccessEmpty")}</p>}
        {rows.map((u) => (
          <SettingRow
            key={u.id}
            label={`${u.fullName} · ${u.role}`}
            description={u.canChooseDay ? t("dayAccessFree") : t("dayAccessLocked")}
          >
            <div className="flex sm:justify-end">
              <Switch checked={u.canChooseDay} onChange={(v) => toggle(u, v)} label={u.fullName} />
            </div>
          </SettingRow>
        ))}
      </SettingsCard>
      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
    </SettingsPanel>
  );
}
