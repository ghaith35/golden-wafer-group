import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superadmin/session";

const PAGE = 20;

/// Who did what, newest first. Filterable by text.
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const page = Math.max(0, Number(sp.get("page") ?? 0));
  const q = (sp.get("q") ?? "").trim();
  const where = q
    ? { OR: [{ action: { contains: q } }, { targetId: { contains: q } }, { targetType: { contains: q } }] }
    : {};
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
