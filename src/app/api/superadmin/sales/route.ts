import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superadmin/session";

const PAGE_SIZE = 50;
const kinds = ["ORDER", "DELIVERY", "INVOICE", "TICKET"] as const;
const statuses = ["DRAFT", "CONFIRMED", "DELIVERED", "INVOICED", "CANCELLED"] as const;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const companyId = sp.get("companyId") ?? "";
  const kind = sp.get("kind") ?? "";
  const status = sp.get("status") ?? "";
  const q = (sp.get("q") ?? "").trim();
  const requestedPage = Number(sp.get("page") ?? 0);
  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.floor(requestedPage)) : 0;
  const where = {
    ...(companyId ? { companyId } : {}),
    ...(kinds.includes(kind as (typeof kinds)[number]) ? { kind: kind as (typeof kinds)[number] } : {}),
    ...(statuses.includes(status as (typeof statuses)[number]) ? { status: status as (typeof statuses)[number] } : {}),
    ...(q ? { OR: [
      { number: { contains: q } },
      { company: { name: { contains: q, mode: "insensitive" as const } } },
      { client: { name: { contains: q, mode: "insensitive" as const } } },
      { client: { phone: { contains: q } } },
    ] } : {}),
  };
  const [rows, total, companies] = await Promise.all([
    prisma.sale.findMany({
      where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: page * PAGE_SIZE, take: PAGE_SIZE,
      select: {
        id: true, companyId: true, kind: true, status: true, channel: true, number: true, total: true, paid: true,
        remise: true, date: true, createdAt: true, notes: true,
        company: { select: { name: true } },
        client: { select: { name: true, phone: true } },
        location: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.sale.count({ where }),
    prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ rows, total, page, pages: Math.ceil(total / PAGE_SIZE), companies });
}