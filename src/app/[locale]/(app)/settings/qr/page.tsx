"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/Toggle";
import { SettingsPanel, SettingsCard, SettingRow, useSectionText } from "@/components/settings/SettingsPanel";
import { api } from "@/components/settings/api";

type Van = {
  id: string;
  name: string;
  matricule: string | null;
  qrSellRequired: boolean;
  qrOrderRequired: boolean;
  user: { fullName: string } | null;
};
type Key = "qrSellRequired" | "qrOrderRequired";

/// Per-van QR rules: one switch to require the client QR scan when selling,
/// one when creating an order (كوموند).
export default function QrSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { title, description } = useSectionText("qr", "qrDesc");
  const [rows, setRows] = useState<Van[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/settings/qr").then(setRows).catch(console.error);
  }, []);

  async function save(ids: string[] | "all", key: Key, v: boolean) {
    setError("");
    const prev = rows;
    setRows((r) => r && r.map((x) => (ids === "all" || ids.includes(x.id) ? { ...x, [key]: v } : x)));
    try {
      await api("/api/settings/qr", {
        method: "PATCH",
        body: JSON.stringify(ids === "all" ? { all: true, [key]: v } : { vanId: ids[0], [key]: v }),
      });
    } catch {
      setRows(prev);
      setError(t("qrError"));
    }
  }

  if (!rows) return <p className="py-6 text-sm opacity-60">{tc("loading")}</p>;

  const allOn = (k: Key) => rows.length > 0 && rows.every((r) => r[k]);

  return (
    <SettingsPanel title={title} description={description}>
      {rows.length > 1 && (
        <SettingsCard title={t("qrAll")} description={t("qrAllHint")}>
          <SettingRow label={t("qrSell")} description={t("qrSellHint")}>
            <div className="flex sm:justify-end">
              <Switch checked={allOn("qrSellRequired")} onChange={(v) => save("all", "qrSellRequired", v)} label={t("qrSell")} />
            </div>
          </SettingRow>
          <SettingRow label={t("qrOrder")} description={t("qrOrderHint")}>
            <div className="flex sm:justify-end">
              <Switch checked={allOn("qrOrderRequired")} onChange={(v) => save("all", "qrOrderRequired", v)} label={t("qrOrder")} />
            </div>
          </SettingRow>
        </SettingsCard>
      )}
      {rows.length === 0 && <p className="px-1 py-6 text-sm opacity-60">{t("qrEmpty")}</p>}
      {rows.map((v) => (
        <SettingsCard
          key={v.id}
          title={`${v.name}${v.matricule ? ` · ${v.matricule}` : ""}`}
          description={v.user?.fullName ?? t("qrNoDriver")}
        >
          <SettingRow label={t("qrSell")} description={t("qrSellHint")}>
            <div className="flex sm:justify-end">
              <Switch checked={v.qrSellRequired} onChange={(x) => save([v.id], "qrSellRequired", x)} label={`${v.name} · ${t("qrSell")}`} />
            </div>
          </SettingRow>
          <SettingRow label={t("qrOrder")} description={t("qrOrderHint")}>
            <div className="flex sm:justify-end">
              <Switch checked={v.qrOrderRequired} onChange={(x) => save([v.id], "qrOrderRequired", x)} label={`${v.name} · ${t("qrOrder")}`} />
            </div>
          </SettingRow>
        </SettingsCard>
      ))}
      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
    </SettingsPanel>
  );
}
