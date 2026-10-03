"use client";

import { SlidersHorizontal, ShoppingCart, Boxes, MapPin, History, RefreshCw, Smartphone, KeyRound, Building2, ShieldCheck } from "lucide-react";

export type SettingsSectionKey = "general" | "sales" | "catalog" | "sectors" | "journal" | "company" | "updates" | "devices" | "license" | "admins";

export interface SettingsSection {
  key: SettingsSectionKey;
  href: string;
  Icon: typeof SlidersHorizontal;
  /** Key under the `settings.sections` i18n namespace. */
  labelKey: string;
  descriptionKey: string;
  /** Admin-only sections are hidden from other roles (like Khiata). */
  adminOnly?: boolean;
}

/// One section per page, like Khiata — each settings area lives alone under
/// /settings/<key> instead of one endless scroll.
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: "general", href: "general", Icon: SlidersHorizontal, labelKey: "general", descriptionKey: "generalDesc" },
  { key: "sales", href: "sales", Icon: ShoppingCart, labelKey: "sales", descriptionKey: "salesDesc" },
  { key: "catalog", href: "catalog", Icon: Boxes, labelKey: "catalog", descriptionKey: "catalogDesc" },
  { key: "sectors", href: "sectors", Icon: MapPin, labelKey: "sectors", descriptionKey: "sectorsDesc" },
  { key: "journal", href: "journal", Icon: History, labelKey: "journal", descriptionKey: "journalDesc" },
  { key: "company", href: "company", Icon: Building2, labelKey: "company", descriptionKey: "companyDesc", adminOnly: true },
  { key: "admins", href: "admins", Icon: ShieldCheck, labelKey: "admins", descriptionKey: "adminsDesc", adminOnly: true },
  { key: "updates", href: "updates", Icon: RefreshCw, labelKey: "updates", descriptionKey: "updatesDesc" },
  { key: "devices", href: "devices", Icon: Smartphone, labelKey: "devices", descriptionKey: "devicesDesc", adminOnly: true },
  { key: "license", href: "license", Icon: KeyRound, labelKey: "license", descriptionKey: "licenseDesc", adminOnly: true },
];
