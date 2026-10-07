import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";

/// Owner reconciliation: prove every offline op a device sent reached the PC.
/// Returns APPLIED / FAILED counts and the op ledger for a device (optionally
/// one day), so "0 failed, 0 missing" is verifiable instead of assumed.
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const deviceId = sp.get("deviceId");
  const day = sp.get("day"); // YYYY-MM-DD

  const createdAt: { gte?: Date; lt?: Date } = {};
  if (day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return NextResponse.json({ error: "bad_date" }, { status: 400 });
    const s = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    createdAt.gte = s;
    createdAt.lt = e;
  }

  const where = {
    companyId: auth.session.companyId,
    ...(deviceId ? { deviceId } : {}),
    ...(day ? { createdAt } : {}),
  };

  const [applied, failed, byKind, ops] = await Promise.all([
    prisma.syncOp.count({ where: { ...where, status: "APPLIED" } }),
    prisma.syncOp.count({ where: { ...where, status: "FAILED" } }),
    prisma.syncOp.groupBy({ by: ["kind", "status"], where, _count: { _all: true } }),
    prisma.syncOp.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        opId: true, kind: true, status: true, error: true, resultId: true,
        occurredAt: true, createdAt: true, deviceId: true,
      },
    }),
  ]);

  return NextResponse.json({ applied, failed, byKind, ops });
}
