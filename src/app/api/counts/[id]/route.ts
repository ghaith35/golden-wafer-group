import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { validateCount } from "@/lib/inventory/service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.stockCount.findFirst({
    where: { id: (await params).id, companyId: session.companyId },
    include: { lines: { include: { product: true } }, location: true },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "Admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "validate") return NextResponse.json({ error: "bad_action" }, { status: 400 });
  try {
    const row = await validateCount(session.companyId, (await params).id);
    return NextResponse.json(row);
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
