import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { nextReference } from "@/lib/products/reference";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await prisma.product.findMany({
    where: { companyId: session.companyId, reference: { startsWith: "REF-" } },
    select: { reference: true },
  });
  return NextResponse.json({ reference: nextReference(rows.map((r) => r.reference)) });
}
