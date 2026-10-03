import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superadmin/session";

/// List machines with subscription + key state (newest activity first).
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const q = (sp.get("q") ?? "").trim();
  const rows = await prisma.machine.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ machineId: { contains: q } }, { label: { contains: q } }, { contactName: { contains: q } }, { phone: { contains: q } }] } : {}),
    },
    include: { subscription: true },
    orderBy: { lastSeen: "desc" },
    take: 200,
  });
  return NextResponse.json(rows);
}
