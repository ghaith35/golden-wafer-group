import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShell } from "@/components/layout/AppShell";
import { BtPrintHost } from "@/components/print/BtPrintHost";
import { getSession } from "@/lib/auth/session";
import { ensureMainDepot } from "@/lib/inventory/depot";
import { prisma } from "@/lib/db";
import { getOrCreateSettings } from "@/lib/settings/helpers";
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
  // Self-heal: make sure the company has its main depot (older installs).
  // The signed-in user's role is resolved here (fresh from the DB, like
  // /api/auth/me) so the sidebar renders correctly on the very first paint —
  // no flash of the van menu while the client fetch is in flight.
  let initialRole: string | null = null;
  let initialUsername: string | null = null;
  let initialThreePack = false;
  let initialGps = true;
  try {
    const session = await getSession();
    if (session) {
      await ensureMainDepot(session.companyId);
      const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { username: true, role: true } });
      initialRole = user?.role ?? null;
      initialUsername = user?.username ?? null;
      const settings = await getOrCreateSettings(session.companyId);
      initialThreePack = settings.threePackEnabled ?? false;
      initialGps = settings.gpsEnabled ?? true;
    }
  } catch {
    /* never block the page on this */
  }
  return (
    <>
      <AppShell initialRole={initialRole} initialUsername={initialUsername} initialThreePack={initialThreePack} initialGps={initialGps}>{children}</AppShell>
      {/* APK: full-screen Bluetooth printer flow, opened by any Print button. */}
      <BtPrintHost />
    </>
  );
}
