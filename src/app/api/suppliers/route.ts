import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const rows = await prisma.supplier.findMany({
    where: { companyId: session.companyId, ...(q ? { name: { contains: q } } : {}) },
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name, phone, address, wilayaCode, secteurId, notes } = (await req.json().catch(() => ({}))) as {
    name?: string; phone?: string; address?: string; wilayaCode?: number; secteurId?: string; notes?: string;
  };
  if (!name?.trim()) return NextResponse.json({ error: "validation_error" }, { status: 400 });
  const row = await prisma.supplier.create({
    data: {
      companyId: session.companyId,
      name: name.trim(),
      phone: phone?.trim() || null,
      address: address?.trim() || null,
      wilayaCode: typeof wilayaCode === "number" ? wilayaCode : null,
      secteurId: secteurId || null,
      notes: notes?.trim() || null,
    },
  });
  return NextResponse.json(row, { status: 201 });
}
