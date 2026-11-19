"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Truck, Boxes, ShoppingCart, ShoppingBag, Wallet, BarChart3, Settings, Bus, Map, Route, Store, PanelLeftClose, PanelLeftOpen, Crosshair, Package, PackageCheck, Satellite, ClipboardList, ClipboardCheck, Smartphone, Clock, Banknote, Plus, ReceiptText, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { recordCrumb, serverUnreachable, startReachabilityProbe } from "@/lib/sync/client";
import { canSell } from "@/lib/staff-permissions";
import { TopBar, LanguageSwitcher } from "@/components/layout/TopBar";
import { ConnLostDialog } from "@/components/sync/ConnLostDialog";
import { LAST_PAGE_KEY } from "@/lib/navigation-recovery";
import { watchChunkErrors } from "@/lib/chunk-reload";
import { VanTracker } from "@/components/track/VanTracker";
import { ApkOnly } from "@/components/layout/ApkOnly";
import { LocationPrompt } from "@/components/track/LocationPrompt";
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
      { key: "vanOrders", href: "vans/orders", Icon: ClipboardList, adminOnly: true },
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
    const timer = window.setTimeout(() => {
      if (document.querySelector("[data-route-recovery]")) return;
      try { sessionStorage.setItem(LAST_PAGE_KEY, window.location.pathname); } catch { /* storage unavailable */ }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pathname]);


  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch { /* private mode */ }
    // Pre-warm the phone's offline outbox database (native SQLite in the APK)
    // so the first offline save never pays init cost — or discovers a broken
    // plugin only when the driver is already offline with a customer waiting.
    void import("@/lib/sync/offline-db").then((m) => m.db.ready().catch(() => {})).catch(() => {});
    // Stale-deploy chunk failures ("failed to load chunk") heal with one
    // guarded reload instead of a dead button mid-sale.
    const stopChunkWatch = watchChunkErrors();
    return () => {
      try {
        stopChunkWatch();
      } catch { /* ignore */ }
    };
  }, []);

  // Offline link safety net: Next <Link> transitions need the network (RSC).
  // Offline — phone-offline OR wifi-on/server-dead (see serverUnreachable)
  // — route every in-app link through a full document load instead: the
  // service worker answers from cache, never the browser error page.
  // External links, new tabs and downloads are untouched.
  // Every navigation (online or not) is also recorded on the breadcrumb so
  // back buttons can hard-load the previous warmed page when router.back()
  // cannot work (offline, or the APK where the router cache is empty).
  useEffect(() => {
    startReachabilityProbe();
    const onClick = (e: MouseEvent) => {
      try {
        const t = e.target as HTMLElement | null;
        const a = t?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
        const href = a.getAttribute("href") ?? "";
        if (!href.startsWith("/") || href.startsWith("//")) return;
        // Synchronous: the decision must land before Next handles the click.
        recordCrumb(href);
        if (serverUnreachable()) {
          e.preventDefault();
          e.stopPropagation();
          window.location.assign(href);
        }
      } catch { /* let the click through */ }
    };
    document.addEventListener("click", onClick, true);
    try {
      recordCrumb(window.location.pathname + window.location.search);
    } catch { /* ignore */ }
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  async function logout() {
    // Record the intent FIRST: if the phone is offline the server never
    // hears this — the flag makes the next online mount finish the logout
    // (otherwise the old HttpOnly session silently resumes on reconnect).
    // Only a confirmed server logout clears the flag.
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (res.ok) {
        try {
          localStorage.removeItem("dili_logout_pending");
        } catch { /* ignore */ }
      } else {
        try {
          localStorage.setItem("dili_logout_pending", "1");
        } catch { /* ignore */ }
      }
    } catch {
      try {
        localStorage.setItem("dili_logout_pending", "1");
      } catch { /* ignore */ }
    }
    // Logging out must also forget the offline credential — otherwise the
    // phone stays unlockable without the password ever being asked again.
    try {
      const m = await import("@/lib/sync/client");
      m.clearOfflineCred();
    } catch { /* best-effort */ }
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

  const syncLabels = {
    offline: ts("offline"), pending: ts("pending"), sync: ts("sync"), synced: ts("synced"), noDevice: ts("noDevice"),
    upload: ts("upload"), download: ts("download"), images: ts("images"),
    applied: ts("applied"), failed: ts("failed"), remaining: ts("remaining"),
    retry: ts("retry"), failedOps: ts("failedOps"),
    pairing: ts("pairing"), pairFail: ts("pairFail"), syncOk: ts("syncOk"), syncNow: ts("syncNow"),
  };
  const connLabels = {
    title: ts("connLost"), hint: ts("connLostHint"), pendingSaved: ts("pendingSaved"),
    continueOffline: ts("continueOffline"), switching: ts("switching"), offlineReady: ts("offlineReady"),
    retry: ts("retryNow"),
    backOnline: ts("backOnline"), syncing: ts("syncingNow"),
  };
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

  // Staff menu: Vendeur (مندوب) gets the same strictly-limited van
  // workspace menu as Livreur — sale + factures are additionally gated
  // inside the day flow for Vendeur, so the tiles never render there.
  // Unknown role (still loading, offline PWA shell, fetch failed) defaults
  // to the most restricted view — never the full admin menu.
  const [role, setRole] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    // Finish a logout that happened while offline: the server never heard
    // it, so kill the resurrected session as soon as we're back online.
    try {
      if (typeof window !== "undefined" && window.navigator?.onLine !== false && localStorage.getItem("dili_logout_pending") === "1") {
        fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
          .then((r) => {
            if (r.ok) {
              try {
                localStorage.removeItem("dili_logout_pending");
              } catch { /* ignore */ }
            }
          })
          .catch(() => {});
      }
    } catch { /* ignore */ }
    fetch("/api/auth/me")
      .then((r) => {
        if (r.status >= 500) throw new Error("server_unreachable");
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        setRole((d?.user?.role as string | undefined) ?? null);
        setUsername((d?.user?.username as string | undefined) ?? null);
      })
      .catch(() => {
        // Offline (the request itself failed — a 401 would resolve, not
        // reject): without a fresh offline unlock, bounce to login, which
        // renders unlock mode from the cached credential — or the
        // "connect once" notice on a never-activated phone.
        void import("@/lib/sync/client")
          .then((m) => {
            // Offline menu correctness (APK/van phones): the cached credential
            // carries the staff role, so a Vendeur keeps his reduced menu —
            // minus sales — instead of falling back to the livreur view.
            // Unknown role still defaults to the most restricted view.
            const cached = m.getOfflineCred();
            if (cached?.role) setRole(cached.role);
            if (!m.hasOfflineUnlock()) window.location.replace(`/${locale}/login`);
          })
          .catch(() => {});
      });
  }, []);
  const isStaff = role !== "Admin";
  // Van-only menu for every non-admin (Vendeur + Livreur + unknown).
  const vanOnlyMenu = role !== "Admin";

  /// Staff sidebar = every dashboard card (mirrors the day hub tiles, same
  /// gating: Vendeur never sees sale/factures/demande). Day-scoped from the
  /// URL while inside a journée, else today. Action-tiles (till/sync modals)
  /// have no page — the hub entry below reaches them.
  function staffDayItems(): Item[] {
    let day = "";
    try {
      const m = (pathname ?? "").match(/\/livreur\/(\d{4}-\d{1,2}-\d{1,2})/);
      if (m) day = m[1];
    } catch { /* fall through to today */ }
    if (!day) {
      const d = new Date();
      day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }
    const sell = canSell(role);
    const depotView = role === "Vendeur";
    const items: Item[] = [
      { key: "vanDash", href: `livreur/${day}/dashboard`, Icon: LayoutDashboard },
      { key: "vanTournee", href: `livreur/${day}/start`, Icon: Route },
      { key: "vanSale", href: `livreur/${day}/vente`, Icon: Plus },
      { key: "vanFactures", href: `livreur/${day}/factures`, Icon: ReceiptText },
      { key: "vanOrder", href: `livreur/${day}/commande`, Icon: ClipboardList },
      { key: "vanOrders", href: `livreur/${day}/commandes`, Icon: ClipboardCheck },
      { key: "vanDemande", href: `livreur/${day}/demande`, Icon: PackageCheck },
      { key: depotView ? "vanDepot" : "vanStock", href: `livreur/${day}/stock`, Icon: Package },
      { key: "vanExpense", href: `livreur/${day}/expenses`, Icon: Wallet },
      { key: "vanClients", href: `livreur/${day}`, Icon: UserRound },
      // Vendeur enters the same van flow, but it reads "Get command" —
      // never "sell van".
      { key: role === "Vendeur" ? "vendeurFlow" : "livreur", href: "livreur", Icon: Smartphone },
    ];
    return sell ? items : items.filter((i) => i.key !== "vanSale" && i.key !== "vanFactures" && i.key !== "vanDemande");
  }

  const visibleGroups = (vanOnlyMenu
    ? [{
        label: "group_livreur",
        items: staffDayItems(),
      }]
    : GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => !isStaff || !i.adminOnly),
      }))
  ).filter((g) => (!isStaff || !g.adminOnly) && g.items.length > 0)
    // The van workspace (الشاحنة / بيع الشاحنة) is staff-only: admins manage
    // vans from الشاحنات / مخزون الشاحنات instead.
    .filter((g) => g.label !== "group_livreur" || isStaff);
  // Staff have no bottom tab bar (the sell-van tab is gone) — every section
  // lives in the sidebar/drawer instead. Admins keep their four tabs.
  const visibleTabs = vanOnlyMenu
    ? []
    : TABS.filter((t) => {
        const item = GROUPS.flatMap((g) => g.items).find((i) => i.key === t.key);
        return !isStaff || !item?.adminOnly;
      });

  return (
    <div className="min-h-screen">
      {/* Van APK auto GPS: activates only when a device token is bound.
          Desktop browsers have none — zero behavior change there. */}
      <ApkOnly><VanTracker /></ApkOnly>
      {/* No-fix banner (van phones): summons the Android allow-location
          form when the office can't see the driver. Token-gated inside. */}
      <ApkOnly><LocationPrompt
        labels={{ title: ts("locTitle"), hint: ts("locHint"), enable: ts("locEnable"), deniedHint: ts("locDenied") }}
      /></ApkOnly>
      {/* Silent web updates + native APK banner (phones). No-op when fresh. */}
      <ApkOnly><AutoUpdate /></ApkOnly>
      {/* Desktop sidebar — hidden on the Journée picker until a day is chosen.
          print:hidden everywhere: print pages (ticket, sheets) output only
          their document, never the app chrome. */}
      {!hideChrome && (
      <aside
        className={cn(
          "app-sidebar fixed inset-y-0 start-0 hidden flex-col border-e border-(--border-default) transition-all duration-300 ease-in-out print:hidden md:flex",
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
        <div className="fixed inset-0 z-50 print:hidden md:hidden">
          <button
            type="button"
            aria-label={t("closeMenu")}
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/45"
          />
          <div className="app-sidebar absolute inset-y-0 start-0 flex w-60 max-w-[80vw] flex-col border-e border-(--border-default) p-4">
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

      <div data-shell-content className={cn("pt-[calc(60px+env(safe-area-inset-top))] transition-all duration-300 ease-in-out md:pt-[calc(3.5rem+env(safe-area-inset-top))] print:pt-0", !hideChrome && (collapsed ? "md:ps-[68px]" : "md:ps-60"))}>
        <TopBar onMenuClick={() => setNavOpen(true)} onLogout={logout} syncLabels={syncLabels} forceSyncShow={role !== "Admin"} hideMenu={hideChrome} username={username} sidebarOffset={hideChrome ? "none" : collapsed ? "slim" : "wide"} />
        <main className={!hideChrome && visibleTabs.length > 0 ? "pb-20 md:pb-0" : ""}>{children}</main>
        {/* Global connection-loss dialog: one controlled reload into offline
            mode instead of a silently half-broken page. Mounted for every
            role — drivers need it most, admins hit dead tunnels too. */}
        <ApkOnly><ConnLostDialog labels={connLabels} /></ApkOnly>
        {!hideChrome && visibleTabs.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 flex border-t border-(--border-default) bg-(--bg-overlay) pb-[env(safe-area-inset-bottom)] print:hidden md:hidden">
          {visibleTabs.map((item) => (
            <Link key={item.key} href={`/${locale}/${item.href}`} className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[10px] font-semibold leading-tight opacity-70">
              <item.Icon size={19} />
              <span className="max-w-full truncate">{t(item.key)}</span>
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
  const ta = useTranslations("app");
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
      <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "gap-2")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/logo-192.png" alt="Golden Wafer" className="h-9 w-9 shrink-0 rounded-xl shadow-[0_6px_16px_-6px_var(--brand-600)]" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[17px] font-black leading-tight tracking-tight" dir="ltr">
              <span className="text-(--text-primary)">GOLDEN</span><span className="logo-accent text-(--brand-600)"> WAFER</span>
            </div>
            <div className="truncate text-[10px] font-bold text-(--text-tertiary)">{ta("tagline")}</div>
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
            "side-item mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-(--border-default) text-(--text-secondary) hover:border-(--brand-500) hover:text-(--brand-600)",
            collapsed ? "mx-auto hidden md:flex" : "ms-auto"
          )}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      )}

      <nav className="side-nav min-h-0 flex-1 overflow-y-auto px-0 py-0.5">
        {groups.map((group, gi) => (
          <div key={group.label} className={cn("mt-0.5 first:mt-0", gi > 0 && "mt-1.5 border-t border-(--border-subtle) pt-1.5")}>
            {!collapsed && (
              <div className="px-2.5 pb-px text-[9px] font-black uppercase text-(--text-tertiary)">
                {t(group.label)}
              </div>
            )}
            <ul className="space-y-px">
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
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        "side-item group relative flex min-h-[34px] items-center rounded-lg text-[12px] font-bold",
                        collapsed
                          ? "justify-center px-0 py-0.5"
                          : "gap-1.5 px-1.5 py-1",
                        active
                          ? "bg-[color-mix(in_srgb,var(--brand-500)_12%,transparent)] text-(--brand-600)"
                          : "text-(--text-secondary) hover:bg-(--bg-sunken) hover:text-(--text-primary) active:scale-[0.99]"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-180",
                          active
                            ? "bg-(--brand-500) text-white shadow-sm"
                            : "bg-(--bg-sunken) text-(--text-secondary) group-hover:bg-(--bg-overlay) group-hover:text-(--brand-600)"
                        )}
                      >
                        <Icon size={15} strokeWidth={active ? 2.4 : 2} />
                      </span>
                      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                      {!collapsed && active && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--brand-500)" aria-hidden />
                      )}
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
            "side-item mb-1 flex items-center rounded-xl border border-dashed border-(--border-strong) text-(--text-secondary) hover:border-(--brand-500) hover:text-(--brand-600) disabled:opacity-50",
            collapsed ? "mx-auto h-10 w-10 justify-center" : "gap-2 px-3 py-1.5 text-sm font-bold"
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
