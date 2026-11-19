"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/components/settings/sections";

function hrefFor(locale: string, section: SettingsSection) {
  return `/${locale}/settings/${section.href}`;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/// Sticky section rail on desktop + bottom-sheet picker on mobile, like Khiata.
export function SettingsShell({ children, isAdmin }: { children: React.ReactNode; isAdmin: boolean }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);

  const sections = SETTINGS_SECTIONS.filter((s) => !s.adminOnly || isAdmin);
  const current = sections.find((s) => isActive(pathname, hrefFor(locale, s))) ?? sections[0];

  useEffect(() => {
    setPickerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      {/* Mobile: current section button → bottom sheet */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        className="flex w-full items-center gap-3 rounded-[14px] border border-(--border-default) bg-(--bg-overlay) px-3.5 py-3 text-start shadow-[0_8px_30px_rgba(15,14,13,0.04)] transition-colors hover:border-(--brand-500) lg:hidden"
      >
        <current.Icon size={18} className="shrink-0 text-(--brand-600)" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-extrabold text-(--text-primary)">
            {t(`sections.${current.labelKey}`)}
          </span>
          <span className="block truncate text-xs text-(--text-secondary)">
            {t(`sections.${current.descriptionKey}`)}
          </span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-(--text-secondary)" />
      </button>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={tc("cancel")}
            onClick={() => setPickerOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative max-h-[calc(var(--vh)*0.8)] w-full overflow-y-auto rounded-t-2xl border-t border-(--border-default) bg-(--bg-overlay) pb-[env(safe-area-inset-bottom)]">
            <div className="sticky top-0 flex justify-center bg-(--bg-overlay) pb-1 pt-3">
              <span className="h-1 w-10 rounded-full bg-(--border-default)" />
            </div>
            <ul className="flex flex-col gap-1 p-3">
              {sections.map((section) => {
                const href = hrefFor(locale, section);
                const active = isActive(pathname, href);
                return (
                  <li key={section.key}>
                    <Link
                      href={href}
                      onClick={() => setPickerOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-3",
                        active ? "bg-(--brand-500)/10" : "hover:bg-(--bg-sunken)"
                      )}
                    >
                      <section.Icon size={18} className={cn("shrink-0", active ? "text-(--brand-600)" : "text-(--text-secondary)")} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm text-(--text-primary)", active ? "font-extrabold" : "font-bold")}>
                          {t(`sections.${section.labelKey}`)}
                        </span>
                        <span className="block truncate text-xs text-(--text-secondary)">
                          {t(`sections.${section.descriptionKey}`)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Desktop: sticky rail */}
      <nav aria-label={t("title")} className="hidden w-[248px] shrink-0 lg:sticky lg:top-20 lg:block xl:w-72">
        <ul className="flex flex-col gap-0.5">
          {sections.map((section) => {
            const href = hrefFor(locale, section);
            const active = isActive(pathname, href);
            return (
              <li key={section.key}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-11 items-center gap-3 rounded-[12px] px-3 py-2 text-[13px] transition-colors",
                    "before:absolute before:inset-y-2.5 before:start-0 before:w-0.5 before:rounded-full before:transition-colors",
                    active
                      ? "bg-(--brand-500)/10 font-black text-(--text-primary) before:bg-(--brand-500)"
                      : "font-bold text-(--text-secondary) before:bg-transparent hover:bg-(--bg-sunken) hover:text-(--text-primary)"
                  )}
                >
                  <section.Icon size={18} className={cn("shrink-0", active && "text-(--brand-600)")} />
                  <span className="min-w-0 flex-1 truncate">{t(`sections.${section.labelKey}`)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
