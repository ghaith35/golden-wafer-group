"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  FileText,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  KeyRound,
  RadioTower,
} from "lucide-react";
import { cn } from "@/lib/utils";

/// Vendor console shell (repaire-style): collapsible sidebar with sections,
/// mobile drawer, RTL-aware, footer with the signed-in vendor + logout.
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
  const pathname = usePathname();
  const router = useRouter();
  const isRtl = locale === "ar";

  const navItems = [
    {
      section: labels.sectionOverview,
      items: [{ href: `/${locale}/superadmin/dashboard`, Icon: LayoutDashboard, label: labels.dashboard }],
    },
    {
      section: labels.sectionMgmt,
      items: [
        { href: `/${locale}/superadmin/licenses`, Icon: KeyRound, label: labels.licenses },
        { href: `/${locale}/superadmin/companies`, Icon: Building2, label: labels.companies },
      ],
    },
    {
      section: labels.sectionSystem,
      items: [
        { href: `/${locale}/superadmin/audit`, Icon: FileText, label: labels.audit },
        { href: `/${locale}/superadmin/tunnels`, Icon: RadioTower, label: labels.tunnels },
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
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        className={cn(
          "fixed inset-y-0 z-50 flex flex-col transition-all duration-300 lg:translate-x-0",
          collapsed ? "w-[60px]" : "w-[220px]",
          mobileOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full"
        )}
        style={{
          background: "linear-gradient(180deg, var(--sa-sidebar-start), var(--sa-sidebar-end))",
          borderInlineEnd: "1px solid var(--sa-sidebar-footer-border)",
        }}
      >
        <div className={cn("shrink-0", collapsed ? "px-2 pt-4 pb-2" : "px-4 pt-5 pb-3")}>
          <div className="flex items-center justify-between">
            {!collapsed && (
              <span className="text-lg font-black tracking-tight" style={{ color: "#ffffff" }}>
                DISTRI<span style={{ color: "var(--sa-sidebar-accent)" }}>BUILI</span>
              </span>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn("hidden h-7 w-7 items-center justify-center rounded-md lg:flex", collapsed && "w-full")}
              style={{ color: "var(--sa-sidebar-muted)" }}
              title={collapsed ? labels.expand : labels.collapse}
            >
              {collapsed ? (
                <ChevronRight className={cn("h-4 w-4", isRtl && "rotate-180")} />
              ) : (
                <ChevronLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
              )}
            </button>
          </div>
        </div>

        <button onClick={() => setMobileOpen(false)} className="absolute top-4 end-4 text-white lg:hidden">
          <Menu className="h-5 w-5" />
        </button>

        <nav className="flex-1 overflow-y-auto px-2 py-1">
          {navItems.map((section) => (
            <div key={section.section} className="mb-1">
              {!collapsed && (
                <div
                  className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--sa-sidebar-section)" }}
                >
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
                    className={cn("flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition", collapsed && "justify-center")}
                    style={{
                      backgroundColor: isActive ? "var(--sa-sidebar-active-bg)" : "transparent",
                      color: isActive ? "var(--sa-sidebar-active-fg)" : "var(--sa-sidebar-muted)",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = "var(--sa-sidebar-hover-bg)";
                        e.currentTarget.style.color = "var(--sa-sidebar-hover-fg)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = "transparent";
                        e.currentTarget.style.color = "var(--sa-sidebar-muted)";
                      }
                    }}
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
          <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: "var(--sa-sidebar-footer-border)" }}>
            <p className="truncate font-mono text-xs font-medium" dir="ltr" style={{ color: "var(--sa-sidebar-fg)" }}>
              {username}
            </p>
            <button
              onClick={() => void logout()}
              className="mt-1 flex items-center gap-1 text-[11px] font-bold hover:opacity-80"
              style={{ color: "var(--sa-sidebar-logout)" }}
            >
              <LogOut className="h-3 w-3" /> {labels.logout}
            </button>
          </div>
        )}
      </aside>

      <div className={cn("flex min-w-0 flex-1 flex-col transition-all duration-300", collapsed ? "lg:ms-[60px]" : "lg:ms-[220px]")}>
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-(--border-default) bg-(--bg-overlay)/80 px-4 backdrop-blur-md">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden" aria-label="menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold text-(--text-primary)">{labels.header}</span>
          <span className="w-5 lg:hidden" />
          <span className="hidden w-5 lg:block" />
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
