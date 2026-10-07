import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superadmin/session";

const PAGE = 20;

/// Who did what, newest first. Filterable by text + date range.
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const page = Math.max(0, Number(sp.get("page") ?? 0));
  const q = (sp.get("q") ?? "").trim();
  const from = sp.get("from");
  const to = sp.get("to");
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) createdAt.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAt.lte = d;
    }
  }
  const where = {
    ...(q
      ? { OR: [{ action: { contains: q } }, { targetId: { contains: q } }, { targetType: { contains: q } }] }
      : {}),
    ...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.superAdminAudit.findMany({
      where,
      include: { admin: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      skip: page * PAGE,
      take: PAGE,
    }),
    prisma.superAdminAudit.count({ where }),
  ]);
  return NextResponse.json({ rows, total, page, pages: Math.ceil(total / PAGE) });
}
