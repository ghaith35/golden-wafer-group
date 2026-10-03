import { AppShell } from "@/components/layout/AppShell";

/// Authenticated staff surface — everything here gets the sidebar shell.
/// Public routes (login, portal, activate) live in (public) with no shell.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
