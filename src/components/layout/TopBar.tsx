"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, LogOut, Menu, Moon, Sun, UserRound } from "lucide-react";
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
  username = null,
}: {
  onMenuClick: () => void;
  onLogout: () => void;
  syncLabels: { offline: string; pending: string; sync: string; synced: string; noDevice: string };
  hideMenu?: boolean;
  username?: string | null;
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
      <UserMenu username={username} onLogout={onLogout} />
    </header>
  );
}

/// Signed-in user chip: shows the name; clicking reveals disconnect.
function UserMenu({ username, onLogout }: { username: string | null; onLogout: () => void }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const initial = (username ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={username ?? t("logout")}
        className="flex h-11 min-w-11 items-center gap-2 rounded-xl border border-(--border-default) bg-(--bg-overlay) px-2 text-sm font-black text-(--text-primary) transition-colors hover:border-(--brand-500)"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-xs font-black text-white">
          {username ? initial : <UserRound size={14} />}
        </span>
        {username && <span className="hidden max-w-32 truncate sm:block">{username}</span>}
        <ChevronDown size={14} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-[calc(100%+8px)] z-50 w-52 overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-overlay) p-1.5 shadow-xl"
        >
          {username && (
            <div className="truncate px-2.5 py-2 text-xs font-bold opacity-60" dir="auto">
              {username}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm font-black text-red-500 transition-colors hover:bg-red-500/10"
          >
            <LogOut size={16} />
            {t("logout")}
          </button>
        </div>
      )}
    </div>
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
