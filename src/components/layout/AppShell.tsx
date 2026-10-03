"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Truck, Boxes, ShoppingCart, ShoppingBag, Wallet, BarChart3, Settings, Bus, Map, Route, Store, PanelLeftClose, PanelLeftOpen, Crosshair, Package, Satellite, ClipboardList, Smartphone, Clock, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";
import { TopBar, LanguageSwitcher } from "@/components/layout/TopBar";
import { VanTracker } from "@/components/track/VanTracker";
import { AutoUpdate } from "@/components/sync/AutoUpdate";
import { useSavedDistances } from "@/lib/geo";

const COLLAPSED_KEY = "distribuili-sidebar-collapsed";

type Item = { key: string; href: string; Icon: typeof LayoutDashboard; adminOnly?: boolean };

/// Sidebar groups, mirroring Khiata's sectioned nav.
/// Staff (Vendeur/Livreur) see a reduced menu: dashboard, clients, sales,
/// commandes, tournees, suivi, livreur, carte. Everything else is admin-only.
const GROUPS: Array<{ label: string; items: Item[]; adminOnly?: boolean }> = [
  {
    label: "group_main",
    items: [{ key: "dashboard", href: "dashboard", Icon: LayoutDashboard }],
  },
  {
    label: "group_operations",
    items: [
      { key: "clients", href: "clients", Icon: Users },
      { key: "suppliers", href: "suppliers", Icon: Truck, adminOnly: true },
      { key: "sales", href: "sales", Icon: ShoppingCart },
      { key: "commandes", href: "commandes", Icon: ClipboardList },
      { key: "pos", href: "pos", Icon: Store, adminOnly: true },
      { key: "purchases", href: "purchases", Icon: ShoppingBag, adminOnly: true },
      { key: "inventory", href: "products", Icon: Boxes, adminOnly: true },
    ],
  },
  {
    label: "group_distribution",
    items: [
      { key: "tournees", href: "tournees", Icon: Route },
      { key: "vans", href: "vans", Icon: Bus, adminOnly: true },
      { key: "suivi", href: "suivi", Icon: Satellite },
      { key: "presence", href: "presence", Icon: Clock },
      { key: "vanStock", href: "vans/stock", Icon: Package, adminOnly: true },
      { key: "carte", href: "carte", Icon: Map },
      { key: "livreursVendeurs", href: "users", Icon: Users, adminOnly: true },
    ],
  },
  {
    label: "group_livreur",
    items: [
      { key: "livreur", href: "livreur", Icon: Smartphone },
    ],
  },
  {
    label: "group_finance",
    adminOnly: true,
    items: [
      { key: "debtsClients", href: "dettes?party=clients", Icon: Users },
      { key: "debtsSuppliers", href: "dettes?party=suppliers", Icon: Truck },
      { key: "dailyCash", href: "cash-daily", Icon: Banknote },
      { key: "expenses", href: "expenses", Icon: Wallet },
      { key: "reports", href: "reports", Icon: BarChart3 },
    ],
  },
  {
    label: "group_admin",
    adminOnly: true,
    items: [
      { key: "settings", href: "settings", Icon: Settings },
    ],
  },
];

/// Mobile bottom tab bar — fixed keys so sidebar regroups never shift it.
const TAB_KEYS = ["dashboard", "clients", "suppliers", "sales"];
const TAB_KEYS_LIVREUR = ["livreur", "commandes", "dashboard"];
const TABS: Item[] = TAB_KEYS.flatMap((k) => GROUPS.flatMap((g) => g.items).filter((i) => i.key === k));

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const ts = useTranslations("sync");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  // Livreur flow: app chrome (sidebar, drawer, tabs) stays hidden on the
  // Journée picker and appears once a day is selected.
  const hideChrome = /^\/[a-z]{2}\/livreur\/?$/.test(pathname ?? "");
  // Start expanded so the first render matches the server HTML, then apply
  // the persisted choice. Reading localStorage in the useState initializer
  // would render collapsed on the client but expanded on the server — a
  // hydration mismatch for anyone who collapsed the sidebar.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch { /* private mode */ }
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push(`/${locale}/login`);
  }

  function toggleCollapse() {
    // Keep the updater pure: side effects (localStorage) stay outside, in
    // the event handler, never inside setState.
    const next = !collapsed;
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch { /* private mode */ }
    setCollapsed(next);
  }

  const syncLabels = { offline: ts("offline"), pending: ts("pending"), sync: ts("sync"), synced: ts("synced"), noDevice: ts("noDevice") };
  const tg = useTranslations("tournees");
  const gpsLabels = { locate: tg("locate"), geoDenied: tg("geoDenied") };

  // Global GPS feature flag (settings toggle). Defaults on; hidden once the
  // server says otherwise.
  const [gpsOn, setGpsOn] = useState(true);
  useEffect(() => {
    fetch("/api/settings/public")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.gpsEnabled === "boolean") setGpsOn(d.gpsEnabled);
      })
      .catch(() => {});
  }, []);

  // Staff role: Vendeur gets the reduced menu, Livreur gets ONLY Tournée
  // vente (dedicated mobile sections replace the desktop sidebar).
  // Defaults to full (admin) until the check returns.
  const [role, setRole] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setRole((d?.user?.role as string | undefined) ?? null);
        setUsername((d?.user?.username as string | undefined) ?? null);
      })
      .catch(() => {});
  }, []);
  const isStaff = role === "Vendeur" || role === "Livreur";
  const isLivreur = role === "Livreur";

  const visibleGroups = (isLivreur
    ? [{
        label: "group_distribution",
        items: GROUPS.flatMap((g) => g.items).filter((i) => i.key === "livreur"),
      }]
    : GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => !isStaff || !i.adminOnly),
      }))
  ).filter((g) => (!isStaff || !g.adminOnly) && g.items.length > 0)
    // The van workspace (الشاحنة / بيع الشاحنة) is staff-only: admins manage
    // vans from الشاحنات / مخزون الشاحنات instead.
    .filter((g) => g.label !== "group_livreur" || isStaff);
  const visibleTabs = isLivreur
    ? TAB_KEYS_LIVREUR.flatMap((k) => GROUPS.flatMap((g) => g.items).filter((i) => i.key === k))
    : TABS.filter((t) => {
        const item = GROUPS.flatMap((g) => g.items).find((i) => i.key === t.key);
        return !isStaff || !item?.adminOnly;
      });

  return (
    <div className="min-h-screen">
      {/* Van APK auto GPS: activates only when a device token is bound.
          Desktop browsers have none — zero behavior change there. */}
      <VanTracker />
      {/* Silent web updates + native APK banner (phones). No-op when fresh. */}
      <AutoUpdate />
      {/* Desktop sidebar — hidden on the Journée picker until a day is chosen */}
      {!hideChrome && (
      <aside
        className={cn(
          "fixed inset-y-0 start-0 hidden flex-col border-e border-(--border-default) bg-(--bg-overlay) transition-all duration-300 ease-in-out lg:flex",
          collapsed ? "w-[68px] overflow-visible p-2" : "w-60 overflow-hidden p-3"
        )}
      >
        <SidebarBody
          groups={visibleGroups}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onNavigate={() => {}}
          showLang={false}
          gpsOn={gpsOn}
          gpsLabels={gpsLabels}
        />
      </aside>
      )}

      {/* Mobile drawer — always expanded */}
      {!hideChrome && navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t("closeMenu")}
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/45"
          />
          <div className="absolute inset-y-0 start-0 flex w-60 max-w-[80vw] flex-col border-e border-(--border-default) bg-(--bg-overlay) p-4">
            <SidebarBody
              groups={visibleGroups}
              collapsed={false}
              onToggleCollapse={toggleCollapse}
              onNavigate={() => setNavOpen(false)}
              showLang
              showCollapseToggle={false}
              gpsOn={gpsOn}
              gpsLabels={gpsLabels}
            />
          </div>
        </div>
      )}

      <div className={cn("transition-all duration-300 ease-in-out", !hideChrome && (collapsed ? "lg:ps-[68px]" : "lg:ps-60"))}>
        <TopBar onMenuClick={() => setNavOpen(true)} onLogout={logout} syncLabels={syncLabels} hideMenu={hideChrome} username={username} />
        <main className={hideChrome ? "" : "pb-20 lg:pb-0"}>{children}</main>
        {!hideChrome && visibleTabs.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 flex border-t border-(--border-default) bg-(--bg-overlay) pb-[env(safe-area-inset-bottom)] lg:hidden">
          {visibleTabs.map(({ key, href, Icon }) => (
            <Link key={key} href={`/${locale}/${href}`} className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[10px] font-semibold leading-tight opacity-70">
              <Icon size={19} />
              <span className="max-w-full truncate">{t(key)}</span>
            </Link>
          ))}
        </nav>
        )}
      </div>
    </div>
  );
}

function SidebarBody({
  groups,
  collapsed,
  onToggleCollapse,
  onNavigate,
  showLang,
  showCollapseToggle = true,
  gpsOn,
  gpsLabels,
}: {
  groups: Array<{ label: string; items: Item[] }>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: () => void;
  showLang: boolean;
  showCollapseToggle?: boolean;
  gpsOn: boolean;
  gpsLabels: { locate: string; geoDenied: string };
}) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  /// Query-aware highlight for split entries (dettes?party=clients vs
  /// dettes?party=suppliers): useSearchParams would force a Suspense
  /// boundary, so track location.search on navigation instead.
  const [navQuery, setNavQuery] = useState("");
  useEffect(() => {
    setNavQuery(window.location.search);
  }, [pathname]);
  // Global position refresh (per-user snapshot). Meta unused here.
  const { locating, geoError, locate } = useSavedDistances({ unitM: "", unitKm: "", unitMin: "" });

  return (
    <>
      <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "gap-2.5")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/logo-192.png" alt="Distribuili" className="h-8 w-8 shrink-0 rounded-[10px]" />
        {!collapsed && (
          <div className="min-w-0 text-lg font-extrabold tracking-tight" dir="ltr">
            <span className="text-(--text-primary)">DISTRIB</span>
            <span
              style={{
                background: "linear-gradient(135deg, #d9f99d, #84cc16 50%, #65a30d)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >UILI</span>
          </div>
        )}
      </div>

      {showCollapseToggle && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t("expand") : t("collapse")}
          title={collapsed ? t("expand") : t("collapse")}
          className={cn(
            "mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-(--border-default) text-(--text-secondary) transition-colors hover:bg-(--bg-sunken) hover:text-(--text-primary)",
            collapsed ? "mx-auto hidden lg:flex" : "ms-auto"
          )}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      )}

      <nav className="flex-1 overflow-hidden px-0 py-0.5">
        {groups.map((group) => (
          <div key={group.label} className="mt-0.5 first:mt-0">
            {!collapsed && (
              <div className="px-3 pb-0 pt-1 text-[10px] font-black uppercase tracking-wider text-(--text-secondary) opacity-70">
                {t(group.label)}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map(({ key, href, Icon }) => {
                // Longest-href wins so /vans/stock doesn't also light up /vans.
                // Split entries (dettes?party=…) also match their query part.
                const [base, qs] = href.split("?");
                const queryOk = !qs || navQuery === `?${qs}`;
                const active =
                  pathname.includes(`/${base}`) &&
                  queryOk &&
                  !group.items.some((o) => {
                    const [ob] = o.href.split("?");
                    return o.href !== href && ob.startsWith(`${base}/`) && pathname.includes(`/${ob}`);
                  });
                const label = t(key);
                return (
                  <li key={key}>
                    <Link
                      href={`/${locale}/${href}`}
                      onClick={() => { setNavQuery(qs ? `?${qs}` : ""); onNavigate(); }}
                      aria-label={collapsed ? label : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        "group relative flex items-center rounded-lg text-sm font-semibold transition-colors",
                        collapsed
                          ? "min-h-11 justify-center px-0 py-2"
                          : "gap-2 px-3 py-1.5",
                        active
                          ? "bg-(--brand-500)/10 text-(--brand-600)"
                          : "opacity-70 hover:bg-(--bg-sunken) hover:opacity-100"
                      )}
                    >
                      <Icon size={collapsed ? 19 : 17} className="shrink-0" />
                      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                      {collapsed && (
                        <span className="pointer-events-none absolute start-full top-1/2 z-50 ms-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-(--border-default) bg-(--bg-overlay) px-3 py-1.5 text-xs font-bold text-(--text-primary) shadow-lg group-hover:block">
                          {label}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {gpsOn && (
        <button
          type="button"
          onClick={() => locate()}
          disabled={locating}
          title={geoError ? gpsLabels.geoDenied : gpsLabels.locate}
          aria-label={gpsLabels.locate}
          className={cn(
            "mb-1 flex items-center rounded-lg border border-dashed border-(--border-default) text-(--text-secondary) transition-colors hover:border-(--brand-500) hover:text-(--brand-600) disabled:opacity-50",
            collapsed ? "mx-auto h-9 w-9 justify-center" : "gap-2 px-3 py-1.5 text-sm font-bold"
          )}
        >
          <Crosshair size={16} className={cn("shrink-0", locating && "animate-spin")} />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{locating ? "…" : gpsLabels.locate}</span>}
        </button>
      )}

      {!collapsed && showLang && (
        <div className="mb-2">
          <LanguageSwitcher />
        </div>
      )}
    </>
  );
}
