import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { generatePortalSecret } from "@/lib/clients/validation";

/// Regenerate the portal secret (login = phone + secret). Returns the plain
/// secret ONCE — show it to the client, it is never readable again.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await prisma.customer.findFirst({ where: { id, companyId: session.companyId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!existing.phone) return NextResponse.json({ error: "phone_required" }, { status: 400 });
  const secret = generatePortalSecret();
  await prisma.customer.update({ where: { id }, data: { portalSecretHash: await bcrypt.hash(secret, 10) } });
  return NextResponse.json({ portalSecret: secret });
}
