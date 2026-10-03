"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, LogOut, Menu, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { SyncBadge } from "@/components/sync/SyncBadge";
import { isDarkNow, toggleDark, THEME_CHANGED_EVENT } from "@/components/theme/ThemeSelector";

/// Route segment → `nav` translation key. Segments without a key fall back to
/// the `tournees` namespace title or the raw segment name.
const LOCALES = ["ar", "fr", "en"] as const;
const LANGUAGE_FULL: Record<string, string> = {
  ar: "العربية",
  fr: "Français",
  en: "English",
};

export function TopBar({
  onMenuClick,
  onLogout,
  syncLabels,
  hideMenu = false,
}: {
  onMenuClick: () => void;
  onLogout: () => void;
  syncLabels: { offline: string; pending: string; sync: string; synced: string; noDevice: string };
  hideMenu?: boolean;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-(--border-default) bg-(--bg-overlay) px-3 py-2 md:px-5 md:h-14 md:py-0">
      <DesktopBackButton />
      {!hideMenu && (
      <button
        type="button"
        aria-label={t("menu")}
        onClick={onMenuClick}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-(--text-primary) lg:hidden"
      >
        <Menu size={18} />
      </button>
      )}

      <div className="min-w-0 flex-1" />

      <SyncBadge labels={syncLabels} />

      <div className="hidden md:block">
        <LanguageSwitcher />
      </div>
      <ThemeToggle />
      <button
        type="button"
        onClick={onLogout}
        title={t("logout")}
        aria-label={t("logout")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--text-secondary) transition-colors hover:bg-(--bg-sunken) hover:text-(--text-primary) md:hidden"
      >
        <LogOut size={17} />
      </button>
      <button
        type="button"
        onClick={onLogout}
        className="hidden shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-(--text-secondary) transition-colors hover:bg-(--bg-sunken) hover:text-(--text-primary) md:flex"
      >
        <LogOut size={17} />
        {t("logout")}
      </button>
    </header>
  );
}

/// Compact AR / FR / EN switcher. Full reload so the server re-renders with
/// the right `dir` + messages (same approach as Khiata).
export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();

  function switchLang(next: string) {
    if (next === locale) return;
    const nextPathname = pathname.match(/^\/(ar|fr|en)(\/|$)/)
      ? pathname.replace(/^\/(ar|fr|en)(?=\/|$)/, `/${next}`)
      : `/${next}${pathname === "/" ? "" : pathname}`;
    window.location.assign(`${nextPathname}${window.location.search}${window.location.hash}`);
  }

  return (
    <div className="flex gap-1 rounded-lg bg-(--bg-sunken) p-1" dir="ltr" role="group" aria-label="language">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchLang(l)}
          aria-pressed={l === locale}
          className={cn(
            "min-h-11 rounded-md px-3 text-xs font-black transition-colors",
            l === locale
              ? "bg-gradient-brand text-white shadow"
              : "text-(--text-secondary) hover:text-(--text-primary)"
          )}
        >
          {LANGUAGE_FULL[l]}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const sync = () => setDark(isDarkNow());
    sync();
    window.addEventListener(THEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
  }, []);

  return (
    <button
      type="button"
      onClick={() => setDark(toggleDark())}
      aria-label={dark ? "Light mode" : "Dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-(--text-primary) transition-colors hover:opacity-80"
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

// Back button for the Electron desktop shell (no browser chrome there).
// Detected via `window.distribuili` (injected by the Electron preload), so it
// never renders in a plain browser. RTL-aware: the chevron flips direction.
function DesktopBackButton() {
  const router = useRouter();
  const [isDesktopShell, setIsDesktopShell] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { distribuili?: unknown }).distribuili) {
      setIsDesktopShell(true);
    }
  }, []);

  if (!isDesktopShell) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Back"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-(--text-primary) transition-colors hover:opacity-80"
    >
      <ChevronLeft size={18} className="rtl:-scale-x-100" />
    </button>
  );
}
