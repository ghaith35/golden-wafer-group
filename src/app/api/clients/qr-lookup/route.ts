import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { parseClientScan } from "@/lib/clients/qr";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const match = typeof body?.qr === "string" ? parseClientScan(body.qr, session.companyId) : null;
  if (!match) return NextResponse.json(null);
  const client = await prisma.customer.findFirst({
    where: { companyId: session.companyId, isActive: true, ...match },
    select: { id: true, name: true, code: true, phone: true, tierId: true, balance: true },
  });
  return NextResponse.json(client);
}
