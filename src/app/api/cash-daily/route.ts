import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { cashMonth } from "@/lib/cash/daily";

/// Month grid for صندوق اليوم (mirror of presence range loading).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const year = Number(sp.get("year") ?? now.getFullYear());
  const month = Number(sp.get("month") ?? now.getMonth() + 1);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "bad_date" }, { status: 400 });
  }
  // Livreur sees only his own van.
  const data = await cashMonth(session.companyId, year, month);
  if (session.role !== "Admin") {
    const van = await prisma.store.findFirst({
      where: { companyId: session.companyId, kind: "VAN", isActive: true, userId: session.userId },
      select: { id: true },
    });
    return NextResponse.json({
      vans: data.vans.filter((v) => v.id === van?.id),
      rows: data.rows.filter((r) => r.vanId === van?.id),
    });
  }
  return NextResponse.json(JSON.parse(JSON.stringify(data)));
}
