import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { clientQrPayload } from "@/lib/clients/validation";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.customer.findFirst({
    where: { id: (await params).id, companyId: session.companyId },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const payload = clientQrPayload(session.companyId, row.code);
  const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 512 });
  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { name: true, phone: true, logoUrl: true },
  });
  return NextResponse.json({ payload, dataUrl, code: row.code, company });
}
