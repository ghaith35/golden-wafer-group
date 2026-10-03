import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { localEntitlement, isLocalMode } from "@/lib/license/gate";

/// Authenticated staff surface — everything here gets the sidebar shell.
/// Public routes (login, portal, activate) live in (public) with no shell.
///
/// Local-install license gate: a locked/expired/unlicensed desktop install
/// steers every staff page to /activate (direct-Chrome bypass closed —
/// Electron navigation already does the same instantly).
export default async function StaffLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  if (isLocalMode() && !localEntitlement().entitled) {
    const { locale } = await params;
    redirect(`/${locale}/activate`);
  }
  return <AppShell>{children}</AppShell>;
}
