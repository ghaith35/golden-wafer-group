"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, KeyRound, Building2, ScrollText, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

/// Vendor console shell: section nav + logout. Rendered only behind the
/// (admin) layout guard, so a session here is always genuine.
export function SuperAdminNav({ locale, username, labels }: { locale: string; username: string; labels: Record<string, string> }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = [
    { href: `/${locale}/superadmin/dashboard`, label: labels.dashboard, Icon: LayoutDashboard },
    { href: `/${locale}/superadmin/licenses`, label: labels.licenses, Icon: KeyRound },
    { href: `/${locale}/superadmin/companies`, label: labels.companies, Icon: Building2 },
    { href: `/${locale}/superadmin/audit`, label: labels.audit, Icon: ScrollText },
  ];

  async function logout() {
    await fetch("/api/superadmin/logout", { method: "POST" }).catch(() => {});
    router.push(`/${locale}/superadmin/login`);
    router.refresh();
  }

  return (
    <div className="mb-4 flex items-center gap-2 overflow-x-auto">
      {items.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-black",
              active ? "bg-(--brand-500)/10 text-(--brand-600)" : "opacity-70 hover:opacity-100"
            )}
          >
            <Icon size={15} />
            {label}
          </Link>
        );
      })}
      <span className="ms-auto flex shrink-0 items-center gap-2 text-xs opacity-60">
        <span className="font-mono" dir="ltr">{username}</span>
        <button type="button" onClick={() => void logout()} className="flex items-center gap-1 font-bold hover:opacity-100" title={labels.logout}>
          <LogOut size={14} />
        </button>
      </span>
    </div>
  );
}
