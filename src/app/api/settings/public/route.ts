import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { prisma } from "@/lib/db";

/// Non-admin-safe settings subset for app chrome (sidebar, feature gates)
/// plus the public company header printed on tickets (name/phone/fiscal
/// IDs are on every printed document anyway).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [s, company] = await Promise.all([
    getOrCreateSettings(session.companyId),
    prisma.company.findUnique({
      where: { id: session.companyId },
      select: { name: true, phone: true, address: true, rc: true, nif: true, logoUrl: true },
    }),
  ]);
  return NextResponse.json({
    gpsEnabled: s.gpsEnabled ?? true,
    threePackEnabled: s.threePackEnabled ?? false,
    qrStrictMode: s.qrStrictMode ?? false,
    ticketLang: s.ticketLang === "ar" ? "ar" : "fr",
    currency: s.currency ?? "DZD",
    company: company ?? { name: "" },
  });
}
