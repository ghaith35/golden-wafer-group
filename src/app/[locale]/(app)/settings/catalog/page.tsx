"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefList, type RefRow } from "@/components/settings/RefList";
import { SettingsPanel, useSectionText } from "@/components/settings/SettingsPanel";
import { api, crud } from "@/components/settings/api";

export default function CatalogSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { title, description } = useSectionText("catalog", "catalogDesc");
  const [units, setUnits] = useState<RefRow[]>([]);
  const [tiers, setTiers] = useState<RefRow[]>([]);
  const [expenseTypes, setExpenseTypes] = useState<RefRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([api("/api/settings/units"), api("/api/settings/price-tiers"), api("/api/settings/expense-types")])
      .then(([u, pt, et]) => {
        setUnits(u);
        setTiers(pt);
        setExpenseTypes(et);
        setReady(true);
      })
      .catch(console.error);
  }, []);

  if (!ready) return <p className="py-6 text-sm opacity-60">{tc("loading")}</p>;

  return (
    <SettingsPanel title={title} description={description}>
      <RefList title={t("units")} rows={units} addLabel={tc("add")} nameLabel={tc("name")} {...crud("/api/settings/units", setUnits)} />
      <RefList title={t("priceTiers")} rows={tiers} addLabel={tc("add")} nameLabel={tc("name")} {...crud("/api/settings/price-tiers", setTiers)} />
      <RefList title={t("expenseTypes")} rows={expenseTypes} addLabel={tc("add")} nameLabel={tc("name")} {...crud("/api/settings/expense-types", setExpenseTypes)} />
    </SettingsPanel>
  );
}
