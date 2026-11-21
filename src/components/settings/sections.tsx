"use client";

import { ShoppingCart, Boxes, MapPin, RefreshCw, Smartphone, CalendarDays, Building2, ShieldCheck, DatabaseZap } from "lucide-react";

export type SettingsSectionKey = "general" | "sales" | "catalog" | "sectors" | "dayAccess" | "journal" | "company" | "updates" | "devices" | "license" | "admins" | "data";

export interface SettingsSection {
  key: SettingsSectionKey;
  href: string;
  Icon: typeof ShoppingCart;
  /** Key under the `settings.sections` i18n namespace. */
  labelKey: string;
  descriptionKey: string;
  /** Admin-only sections are hidden from other roles (like Khiata). */
  adminOnly?: boolean;
}

/// One section per page, like Khiata — each settings area lives alone under
/// /settings/<key> instead of one endless scroll.
/// NOTE (vendor rule): costing/van-binding (general), the journal page, and
/// the business-model toggles are VENDOR-controlled — hidden from the client.
/// The values stay in the DB (superadmin/vendor sets them); the client UI
/// and the PATCH API both refuse them.
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: "sales", href: "sales", Icon: ShoppingCart, labelKey: "sales", descriptionKey: "salesDesc" },
  { key: "catalog", href: "catalog", Icon: Boxes, labelKey: "catalog", descriptionKey: "catalogDesc" },
  { key: "sectors", href: "sectors", Icon: MapPin, labelKey: "sectors", descriptionKey: "sectorsDesc" },
  { key: "dayAccess", href: "day-access", Icon: CalendarDays, labelKey: "dayAccess", descriptionKey: "dayAccessDesc", adminOnly: true },
  { key: "company", href: "company", Icon: Building2, labelKey: "company", descriptionKey: "companyDesc", adminOnly: true },
  { key: "admins", href: "admins", Icon: ShieldCheck, labelKey: "admins", descriptionKey: "adminsDesc", adminOnly: true },
  { key: "updates", href: "updates", Icon: RefreshCw, labelKey: "updates", descriptionKey: "updatesDesc" },
  { key: "data", href: "data", Icon: DatabaseZap, labelKey: "data", descriptionKey: "dataDesc", adminOnly: true },
  { key: "devices", href: "devices", Icon: Smartphone, labelKey: "devices", descriptionKey: "devicesDesc", adminOnly: true },
];
