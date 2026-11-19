"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  KeyRound,
  Server,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isDarkNow, toggleDark, THEME_CHANGED_EVENT } from "@/components/theme/ThemeSelector";
import { AccountSettings } from "./AccountSettings";

/// Vendor console shell (khiata structure, distribuili greens): fixed dark
/// rail with logo + user card, slim header, scrolling main. Collapsible on
/// desktop, drawer on mobile, RTL-aware.
export function SuperAdminShell({
  locale,
  username,
  labels,
  children,
}: {
  locale: string;
  username: string;
  labels: Record<string, string>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  // English-only console: always LTR (hrefs keep the URL locale).
  const isRtl = false;

  useEffect(() => {
    const sync = () => setDark(isDarkNow());
    sync();
    window.addEventListener(THEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const navItems = [
    {
      section: labels.sectionMgmt,
      items: [
        { href: `/${locale}/superadmin/licenses`, Icon: KeyRound, label: labels.licenses },
        { href: `/${locale}/superadmin/deployments`, Icon: Server, label: labels.deployments },
      ],
    },
  ];

  async function logout() {
    await fetch("/api/superadmin/logout", { method: "POST" }).catch(() => {});
    router.push(`/${locale}/superadmin/login`);
    router.refresh();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-(--bg-surface)" dir={isRtl ? "rtl" : "ltr"}>
      {mobileOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 z-30 flex flex-col transition-all duration-300 ease-in-out lg:translate-x-0",
          collapsed ? "w-[64px]" : "w-[232px]",
          mobileOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full"
        )}
        style={{ background: "linear-gradient(180deg, var(--sa-sidebar-start), var(--sa-sidebar-end))" }}
      >
        <div className={cn("shrink-0 border-b border-(--sa-sidebar-footer-border)", collapsed ? "px-2 pt-4 pb-3" : "px-3 pt-4 pb-3")}>
          <div className="flex items-center justify-between">
            <Link
              href={`/${locale}/superadmin/licenses`}
              onClick={() => setMobileOpen(false)}
              className={cn("flex items-center", collapsed ? "justify-center" : "gap-2.5")}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-gradient-brand text-sm font-black text-(--brand-contrast) shadow-[0_10px_24px_rgba(4,120,87,0.35)]">
                D
              </span>
              {!collapsed && (
                <span className="block truncate text-[13px] font-black leading-4 text-(--sa-sidebar-fg)">
                  GOLDEN WAFER
                </span>
              )}
            </Link>
            <button
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? labels.expand : labels.collapse}
              className={cn(
                "hidden h-8 w-8 items-center justify-center rounded-[10px] border border-(--sa-sidebar-footer-border) bg-(--sa-sidebar-hover-bg) text-(--sa-sidebar-muted) transition-colors hover:bg-(--sa-sidebar-active-bg) hover:text-(--sa-sidebar-active-fg) lg:flex",
                collapsed ? "mx-auto" : "ms-auto"
              )}
            >
              {collapsed ? (
                <ChevronRight className={cn("h-4 w-4", isRtl && "rotate-180")} />
              ) : (
                <ChevronLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
              )}
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-1.5 py-2 [scrollbar-width:thin]">
          {navItems.map((section) => (
            <div key={section.section} className="mt-0.5">
              {!collapsed && (
                <div className="px-2 pb-0.5 pt-1.5 text-[8px] font-black uppercase tracking-[0.1em] text-(--sa-sidebar-section)">
                  {section.section}
                </div>
              )}
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-bold transition-colors",
                      collapsed && "justify-center",
                      isActive
                        ? "bg-(--sa-sidebar-active-bg) text-(--sa-sidebar-active-fg)"
                        : "text-(--sa-sidebar-muted) hover:bg-(--sa-sidebar-hover-bg) hover:text-(--sa-sidebar-hover-fg)"
                    )}
                  >
                    <item.Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {!collapsed && (
          <div className="shrink-0 border-t border-(--sa-sidebar-footer-border) p-3">
            <div className="flex items-center gap-2 rounded-[14px] bg-(--sa-sidebar-hover-bg) p-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-(--sa-sidebar-active-bg) text-xs font-black text-(--sa-sidebar-active-fg)">
                {username.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-(--sa-sidebar-fg)">{username}</p>
                <p className="truncate text-[10px] font-bold text-(--sa-sidebar-muted)">vendor</p>
              </div>
            </div>
            <div className="mt-1.5">
              <AccountSettings username={username} labels={labels} dark />
            </div>
            <button
              onClick={() => void logout()}
              className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-(--sa-sidebar-muted) transition-colors hover:bg-(--sa-sidebar-hover-bg) hover:text-(--sa-sidebar-logout)"
            >
              <LogOut className="h-3 w-3" />
              {labels.logout}
            </button>
          </div>
        )}
      </aside>

      <div className={cn("flex min-w-0 flex-1 flex-col transition-all duration-300", collapsed ? "lg:ms-[64px]" : "lg:ms-[232px]")}>
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-(--border-default) bg-(--bg-overlay) px-4">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden" aria-label="menu">
            <Menu className="h-5 w-5 text-(--text-primary)" />
          </button>
          <span className="text-sm font-semibold text-(--text-primary)">{labels.header}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDark(toggleDark())}
              aria-label={dark ? "Light mode" : "Dark mode"}
              title={dark ? "Light mode" : "Dark mode"}
              className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-(--bg-sunken) text-(--text-primary) transition-colors hover:opacity-80"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
