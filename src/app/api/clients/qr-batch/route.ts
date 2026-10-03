import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { clientQrPayload } from "@/lib/clients/validation";

/// Batch QR labels: every code with its client name (print-ready).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const secteurId = sp.get("secteurId");
  const wilayaCode = sp.get("wilayaCode");
  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  const rows = await prisma.customer.findMany({
    where: {
      companyId: session.companyId,
      isActive: true,
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(secteurId ? { secteurId } : {}),
      ...(wilayaCode ? { wilayaCode: Number(wilayaCode) } : {}),
    },
    orderBy: { name: "asc" },
    take: 500,
  });
  const [company, ...labels] = await Promise.all([
    prisma.company.findUnique({
      where: { id: session.companyId },
      select: { name: true, phone: true, logoUrl: true },
    }),
    ...rows.map(async (r) => {
      const payload = clientQrPayload(session.companyId, r.code);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        payload,
        dataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 512 }),
      };
    }),
  ]);
  return NextResponse.json({ company, labels });
}
