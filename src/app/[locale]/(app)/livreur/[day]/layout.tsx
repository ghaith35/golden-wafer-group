import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { isDayAllowed } from "@/lib/livreur/day-access";
import { getLivreurVan } from "../_data";
import { parseDay } from "../_days";

/// Day lock: a Livreur / Vendeur without "may choose the day" can only open
/// today's journée (or the one he already started). Any other day — typed
/// URL, old link, stale tab — bounces to /livreur, which routes him to today.
/// Admins and free users pass through untouched.
export default async function LivreurDayLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; day: string }>;
}) {
  const { locale, day } = await params;
  const session = await getSession();
  if (session && session.role !== "Admin") {
    const date = parseDay(day);
    if (date) {
      const van = await getLivreurVan(session.companyId, session.userId);
      if (!(await isDayAllowed(session, van?.id ?? null, date))) redirect(`/${locale}/livreur`);
    }
  }
  return children;
}
