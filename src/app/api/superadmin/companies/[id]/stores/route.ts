import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit, clientIp, requireSuperAdmin } from "@/lib/superadmin/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id: companyId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const kind = body.kind === "VAN" ? "VAN" : body.kind === "DEPOT" ? "DEPOT" : null;
  if (!name || !kind) return NextResponse.json({ error: "invalid_store" }, { status: 400 });
  try {
    const row = await prisma.store.create({
      data: {
        companyId, name, kind,
        address: typeof body.address === "string" && body.address.trim() ? body.address.trim() : null,
        marque: typeof body.marque === "string" && body.marque.trim() ? body.marque.trim() : null,
        matricule: typeof body.matricule === "string" && body.matricule.trim() ? body.matricule.trim() : null,
      },
      select: { id: true, name: true, address: true, kind: true, marque: true, matricule: true, isActive: true, userId: true },
    });
    await audit(auth.admin.adminId, "company_store_created", "store", row.id, { companyId, kind }, clientIp(req) ?? undefined);
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 400 });
  }
}