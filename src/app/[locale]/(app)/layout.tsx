import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShell } from "@/components/layout/AppShell";
import { localEntitlement, isLocalMode, isDesktopUserAgent } from "@/lib/license/gate";

/// Authenticated staff surface — everything here gets the sidebar shell.
/// Public routes (login, portal, activate) live in (public) with no shell.
///
/// Local-install license gate (desktop shell only): a locked/expired/
/// unlicensed desktop install steers every staff page to /activate
/// (direct-Chrome bypass closed — Electron navigation already does the same
/// instantly). Phones/tablets skip it and work regardless.
export default async function StaffLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  if (isLocalMode() && !localEntitlement().entitled) {
    const ua = (await headers()).get("user-agent");
    if (isDesktopUserAgent(ua)) {
      const { locale } = await params;
      redirect(`/${locale}/activate`);
    }
  }
  return <AppShell>{children}</AppShell>;
}
