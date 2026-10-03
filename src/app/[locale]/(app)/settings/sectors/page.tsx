"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefList, type RefRow } from "@/components/settings/RefList";
import { SettingsPanel, useSectionText } from "@/components/settings/SettingsPanel";
import { api, type Secteur, type Wilaya } from "@/components/settings/api";

export default function SectorsSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { title, description } = useSectionText("sectors", "sectorsDesc");
  const [secteurs, setSecteurs] = useState<Secteur[]>([]);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([api("/api/settings/secteurs"), api("/api/ref/wilayas")])
      .then(([sec, w]) => {
        setSecteurs(sec);
        setWilayas(w);
        setReady(true);
      })
      .catch(console.error);
  }, []);

  if (!ready) return <p className="py-6 text-sm opacity-60">{tc("loading")}</p>;

  return (
    <SettingsPanel title={title} description={description}>
      <RefList
        title={t("secteurs")}
        rows={secteurs.map((s) => ({ id: s.id, name: `${s.wilaya.code} · ${s.name}`, isActive: s.isActive }))}
        addLabel={tc("add")}
        nameLabel={t("secteurName")}
        extra={{ key: "wilayaCode", label: t("wilaya"), options: wilayas.map((w) => ({ value: String(w.code), label: `${w.code} · ${w.nameAr}` })) }}
        onAdd={async (name, extra) => {
          await api("/api/settings/secteurs", { method: "POST", body: JSON.stringify({ name, wilayaCode: Number(extra?.wilayaCode) }) });
          setSecteurs(await api("/api/settings/secteurs"));
        }}
        onToggle={async (row) => {
          const s = secteurs.find((x) => x.id === row.id)!;
          await api(`/api/settings/secteurs/${row.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !s.isActive }) });
          setSecteurs(await api("/api/settings/secteurs"));
        }}
        onRename={async (row: RefRow, name: string) => {
          if (!name.trim()) return;
          await api(`/api/settings/secteurs/${row.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
          setSecteurs(await api("/api/settings/secteurs"));
        }}
        onDelete={async (row: RefRow) => {
          await api(`/api/settings/secteurs/${row.id}`, { method: "DELETE" });
          setSecteurs(await api("/api/settings/secteurs"));
        }}
      />
    </SettingsPanel>
  );
}
