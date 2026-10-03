import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { vanHolds } from "@/lib/holds";

/// Livreur stock view for one van: held-for-commandes vs free-to-sell per
/// product, plus depot availability (for creating new commandes).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const van = await prisma.store.findFirst({
    where: { id, companyId: session.companyId, kind: "VAN" },
    select: { id: true, name: true },
  });
  if (!van) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const data = await vanHolds(session.companyId, van.id);
  return NextResponse.json({ van, ...data });
}
