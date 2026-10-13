"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, LogOut, Menu, Minus, Moon, Plus, Sun, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { serverUnreachable, popCrumb } from "@/lib/sync/client";
import { SyncBadge, type SyncBadgeLabels } from "@/components/sync/SyncBadge";
import { isDarkNow, toggleDark, THEME_CHANGED_EVENT } from "@/components/theme/ThemeSelector";

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
  carte: "carte",
  users: "livreursVendeurs",
  livreur: "livreur",
  dettes: "debtsClients",
  "cash-daily": "dailyCash",
  cash: "dailyCash",
  expenses: "expenses",
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
  hideMenu = false,
  username = null,
}: {
  onMenuClick: () => void;
  onLogout: () => void;
  syncLabels: SyncBadgeLabels;
  hideMenu?: boolean;
  username?: string | null;
}) {
  const t = useTranslations("nav");
  const locale = useLocale();

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-(--border-default) bg-(--bg-overlay) px-3 py-2 print:hidden md:px-5 md:h-14 md:py-0">
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

      <SectionTitle />

      <SyncBadge labels={syncLabels} />

      <div className="hidden items-center gap-2 md:flex">
        <ZoomControl />
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
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-xs font-black text-(--brand-contrast)">
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

/// Chrome-like UI zoom (A− / A+): scales the root font size, so every
/// rem-based element grows/shrinks like browser zoom. Persisted per device.
const ZOOM_KEY = "dili_ui_zoom";
const ZOOM_MIN = 70;
const ZOOM_MAX = 150;
const ZOOM_STEP = 10;

function ZoomControl() {
  // Lazy init from storage: the component remounts on every full document
  // load (locale switch, login redirects), and a 100-default + apply-on-mount
  // would flash the wrong size and clobber the saved value each time.
  // Reading once up front keeps the zoom fixed until the user changes it.
  const [zoom, setZoom] = useState(() => {
    try {
      const raw = window.localStorage.getItem(ZOOM_KEY);
      if (raw === null) return 100; // never set → default, not the min clamp
      const saved = Number(raw);
      if (Number.isFinite(saved)) return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, saved));
    } catch { /* private mode */ }
    return 100;
  });

  useEffect(() => {
    document.documentElement.style.fontSize = `${(16 * zoom) / 100}px`;
    try {
      window.localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch { /* private mode */ }
  }, [zoom]);

  const btn = "flex h-11 w-9 shrink-0 items-center justify-center text-(--text-secondary) transition-colors hover:text-(--text-primary) disabled:opacity-30";

  return (
    <div className="flex items-center rounded-lg bg-(--bg-sunken) p-1" dir="ltr" role="group" aria-label="zoom">
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out (−)"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
        className={btn}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        aria-label="Reset zoom"
        title="Reset (100%)"
        onClick={() => setZoom(100)}
        className="min-h-11 min-w-12 rounded-md px-1 text-xs font-black text-(--text-secondary) transition-colors hover:text-(--text-primary)"
      >
        {zoom}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in (+)"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
        className={btn}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

/// Compact AR / FR / EN switcher. Full reload so the server re-renders with
/// the right `dir` + messages (same approach as Khiata).
/// tone="onDark" renders the light cream pill used on drenched dark screens.
export function LanguageSwitcher({ tone = "light" }: { tone?: "light" | "onDark" }) {
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
    <div
      className={cn(
        "flex gap-1 rounded-xl p-1",
        tone === "onDark" ? "bg-[#edf1e2]/95 shadow-[0_2px_12px_rgba(0,0,0,0.35)]" : "bg-(--bg-sunken)"
      )}
      dir="ltr"
      role="group"
      aria-label="language"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchLang(l)}
          aria-pressed={l === locale}
          className={cn(
            "min-h-10 rounded-lg px-3.5 text-xs font-black transition-colors",
            l === locale
              ? tone === "onDark"
                ? "bg-[#5f8f2e] text-white shadow"
                : "bg-gradient-brand text-(--brand-contrast) shadow"
              : tone === "onDark"
                ? "text-[#43552f] hover:text-[#1d2a12]"
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
