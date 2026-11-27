"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, Globe, Image as ImageIcon, ImageOff, LogOut, Menu, Minus, Moon, Plus, RefreshCw, Sun, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyDataChanged, useRefreshPending } from "@/lib/data-sync";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, getZoom, subscribeZoom, zoomIn, zoomOut, zoomReset } from "@/lib/ui-zoom";
import { serverUnreachable, popCrumb } from "@/lib/sync/client";
import { SyncBadge, type SyncBadgeLabels } from "@/components/sync/SyncBadge";
import { ApkOnly } from "@/components/layout/ApkOnly";
import { isDarkNow, toggleDark, THEME_CHANGED_EVENT } from "@/components/theme/ThemeSelector";
import { getLogoOn, setLogoOn, LOGO_BG_EVENT } from "@/lib/logo-bg";

/// Route segment → `nav` translation key. Segments without a key fall back to
/// the `tournees` namespace title or the raw segment name.
const LOCALES = ["ar", "fr", "en"] as const;const LANGUAGE_FULL: Record<string, string> = {
  ar: "العربية",
  fr: "Français",
  en: "English",
};

/// Section name for the topbar (Khiata pattern: the page never repeats its
/// own title — the bar owns it). Two-segment keys win (vans/stock), then the
/// first segment. `dettes` splits on ?party= (read from location.search in an
/// effect — useSearchParams would force a Suspense boundary).
const TITLE_KEYS: Record<string, string> = {
  dashboard: "dashboard",
  clients: "clients",
  suppliers: "suppliers",
  sales: "sales",
  commandes: "commandes",
  pos: "pos",
  purchases: "purchases",
  products: "inventory",
  inventory: "inventory",
  tournees: "tournees",
  vans: "vans",
  "vans/stock": "vanStock",
  suivi: "suivi",
  presence: "presence",
  closed: "closedVisits",
  carte: "carte",
  users: "livreursVendeurs",
  livreur: "livreur",
  dettes: "debtsClients",
  "cash-daily": "dailyCash",
  cash: "dailyCash",
  expenses: "expenses",
  employees: "employees",
  reports: "reports",
  settings: "settings",
  devices: "devices",
  journal: "journal",
};

function SectionTitle() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  useEffect(() => {
    try {
      setQuery(window.location.search);
    } catch {
      /* ignore */
    }
  }, [pathname]);
  const segs = (pathname ?? "").split("/").filter(Boolean).filter((s) => !(LOCALES as readonly string[]).includes(s));
  const two = segs.slice(0, 2).join("/");
  let key: string | null = TITLE_KEYS[two] ?? TITLE_KEYS[segs[0] ?? ""] ?? null;
  if (segs[0] === "dettes") {
    key = query.includes("party=suppliers") ? "debtsSuppliers" : "debtsClients";
  }
  if (!key) return null;
  let label = key;
  try {
    label = t(key);
  } catch {
    /* fall back to the raw key */
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[15px] font-black tracking-tight">{label}</div>
    </div>
  );
}

export function TopBar({
  onMenuClick,
  onLogout,
  syncLabels,
  forceSyncShow = false,
  hideMenu = false,
  username = null,
  sidebarOffset = "none",
}: {
  onMenuClick: () => void;
  onLogout: () => void;
  syncLabels: SyncBadgeLabels;
  forceSyncShow?: boolean;
  hideMenu?: boolean;
  username?: string | null;
  /// Fixed-header compensation for the desktop sidebar (which the header
  /// must not slide under): none (no sidebar) | slim (collapsed 68px) |
  /// wide (expanded 15rem). Mobile is always full-width.
  sidebarOffset?: "none" | "slim" | "wide";
}) {
  const t = useTranslations("nav");
  const locale = useLocale();

  return (
    <>
    {/* Punch-hole phones: solid white strip behind the status bar / camera
        cutout (clock, wifi, battery) so it never blends with the app.
        Zero-height where there is no cutout — invisible elsewhere. */}
    <div aria-hidden className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-(--bg-overlay) print:hidden" />
    <header className={cn(
      "fixed inset-x-0 top-[env(safe-area-inset-top)] z-30 flex items-center gap-2 border-b border-(--border-default) bg-(--bg-overlay) px-3 pb-2 pt-2 print:hidden md:px-5 md:py-0 md:h-14",
      sidebarOffset === "wide" ? "md:start-60" : sidebarOffset === "slim" ? "md:start-[68px]" : ""
    )}>
      <DesktopBackButton />
      {!hideMenu && (
      <button
        type="button"
        aria-label={t("menu")}
        onClick={onMenuClick}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-(--text-primary) md:hidden"
      >
        <Menu size={18} />
      </button>
      )}

      <SectionTitle />
      {/* Pages with no section title would leave the controls at the START (right in Arabic):
          this spacer always pushes them to the END (left in Arabic). */}
      <span aria-hidden className="ms-auto" />

      <ApkOnly><SyncBadge labels={syncLabels} forceShow={forceSyncShow} /></ApkOnly>

      <RefreshButton />

      <div className="hidden items-center gap-2 md:flex">
        {/* Zoom needs room: shown from 1024px; tablets keep title + language + user. */}
        <div className="hidden lg:block"><ZoomControl /></div>
        <LanguageSwitcher />
      </div>
      <LogoToggle />
      <ThemeToggle />
      <UserMenu username={username} onLogout={onLogout} />
    </header>
    </>
  );
}

/// Actualiser: reloads the current page's data in place (no navigation, open
/// forms keep what was typed). Same action F5 / Ctrl+R trigger.
function RefreshButton() {
  const t = useTranslations("nav");
  const pending = useRefreshPending();
  const mod = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <button
      type="button"
      onClick={() => notifyDataChanged()}
      aria-label={t("refresh")}
      title={`${t("refresh")} (F5 · ${mod} R)`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-default) bg-(--bg-overlay) text-(--text-secondary) transition-colors hover:border-(--brand-500) hover:text-(--brand-600)"
    >
      <RefreshCw size={16} className={cn(pending && "animate-spin")} />
    </button>
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
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-xs font-black text-(--brand-contrast)">
          {username ? initial : <UserRound size={14} />}
        </span>
        {username && <span className="hidden max-w-32 truncate lg:block">{username}</span>}
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

/// Interface zoom: − / 100% / + buttons. Same store as the keyboard shortcuts
/// (Ctrl/Cmd + − 0, wired in UiZoomBoot) — see lib/ui-zoom.ts.
function ZoomControl() {
  const zoom = useSyncExternalStore(subscribeZoom, getZoom, () => ZOOM_DEFAULT);
  const mod = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

  const btn = "flex h-11 w-9 shrink-0 items-center justify-center text-(--text-secondary) transition-colors hover:text-(--text-primary) disabled:opacity-30";

  return (
    <div className="flex items-center rounded-lg bg-(--bg-sunken) p-1" dir="ltr" role="group" aria-label="zoom">
      <button
        type="button"
        aria-label="Zoom out"
        title={`Zoom out (${mod} −)`}
        disabled={zoom <= ZOOM_MIN}
        onClick={zoomOut}
        className={btn}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        aria-label="Reset zoom"
        title={`Reset (${mod} 0)`}
        onClick={zoomReset}
        className="min-h-11 min-w-12 rounded-md px-1 text-xs font-black text-(--text-secondary) transition-colors hover:text-(--text-primary)"
      >
        {zoom}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title={`Zoom in (${mod} +)`}
        disabled={zoom >= ZOOM_MAX}
        onClick={zoomIn}
        className={btn}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

/// AR / FR / EN switcher: one compact button showing the current language;
/// click opens the list. Full reload so the server re-renders with the right
/// `dir` + messages (same approach as Khiata).
/// tone="onDark" renders the light cream pill used on drenched dark screens.
export function LanguageSwitcher({ tone = "light" }: { tone?: "light" | "onDark" }) {
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open && boxRef.current) {
      // Open upwards when there is no room below (sidebar footer, drawers).
      const r = boxRef.current.getBoundingClientRect();
      setUp(window.innerHeight - r.bottom < 190 && r.top > 190);
    }
    setOpen((o) => !o);
  }

  function switchLang(next: string) {
    setOpen(false);
    if (next === locale) return;
    const nextPathname = pathname.match(/^\/(ar|fr|en)(\/|$)/)
      ? pathname.replace(/^\/(ar|fr|en)(?=\/|$)/, `/${next}`)
      : `/${next}${pathname === "/" ? "" : pathname}`;
    window.location.assign(`${nextPathname}${window.location.search}${window.location.hash}`);
  }

  const dark = tone === "onDark";
  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="language"
        className={cn(
          "flex h-11 min-w-11 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-black transition-colors",
          dark
            ? "border-transparent bg-[#fbf1d3]/95 text-[#3a2a06] shadow-[0_2px_12px_rgba(0,0,0,0.35)] hover:bg-[#fbf1d3]"
            : "border-(--border-default) bg-(--bg-overlay) text-(--text-primary) hover:border-(--brand-500)"
        )}
      >
        <Globe size={15} className={dark ? "text-[#85600e]" : "text-(--gold-text)"} />
        <span className="lang-code sm:hidden">{locale.toUpperCase()}</span>
        <span className="lang-full hidden sm:block">{LANGUAGE_FULL[locale as keyof typeof LANGUAGE_FULL] ?? locale}</span>
        <ChevronDown size={13} className={cn("shrink-0 opacity-60 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="language"
          className={cn(
            "absolute end-0 z-50 w-44 overflow-hidden rounded-xl border p-1 shadow-xl",
            up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
            dark ? "border-[#e8ba4c]/40 bg-[#fbf1d3] text-[#3a2a06]" : "border-(--border-default) bg-(--bg-overlay) text-(--text-primary)"
          )}
          style={{ animation: "gw-pop 0.18s var(--ease-out)", transformOrigin: up ? "bottom" : "top" }}
        >
          {LOCALES.map((l) => (
            <li key={l} role="option" aria-selected={l === locale}>
              <button
                type="button"
                onClick={() => switchLang(l)}
                className={cn(
                  "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-start text-sm font-black transition-colors",
                  l === locale
                    ? dark ? "bg-[#c9951a] text-[#1c1200]" : "bg-gradient-brand text-(--brand-contrast)"
                    : dark ? "hover:bg-[#e8ba4c]/25" : "hover:bg-(--bg-sunken)"
                )}
              >
                <span>{LANGUAGE_FULL[l]}</span>
                {l === locale ? <Check size={15} /> : <span className="text-[10px] font-bold opacity-50">{l.toUpperCase()}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/// Show / hide the logo layer behind the main screen (remembered on this device).
function LogoToggle() {
  const t = useTranslations("nav");
  const on = useSyncExternalStore(
    (cb) => {
      window.addEventListener(LOGO_BG_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(LOGO_BG_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    getLogoOn,
    () => true
  );
  const label = on ? t("logoHide") : t("logoShow");
  return (
    <button
      type="button"
      onClick={() => setLogoOn(!on)}
      aria-label={label}
      aria-pressed={!on}
      title={label}
      className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-(--text-primary) transition-colors hover:opacity-80 sm:flex"
    >
      {on ? <ImageIcon size={17} /> : <ImageOff size={17} />}
    </button>
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
      onClick={() => {
        // Offline (phone-offline OR wifi-on/server-dead) the client-side back
        // transition needs the network — fall back to a full load of the
        // previous warmed page (or stay in place when there is no breadcrumb;
        // the sidebar always offers a way out).
        try {
          if (typeof window !== "undefined" && (window.navigator?.onLine === false || serverUnreachable())) {
            const prev = popCrumb();
            if (prev) window.location.assign(prev);
            else router.back();
            return;
          }
        } catch { /* fall through */ }
        router.back();
      }}
      aria-label="Back"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--bg-sunken) text-(--text-primary) transition-colors hover:opacity-80"
    >
      <ChevronLeft size={18} className="rtl:-scale-x-100" />
    </button>
  );
}
