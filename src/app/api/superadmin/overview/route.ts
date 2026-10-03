import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superadmin/session";

/// Console numbers: machines by status, trials expiring, totals.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const [machines, trialsExpiring, companies, keys, audits] = await Promise.all([
    prisma.machine.groupBy({ by: ["status"], _count: true }),
    prisma.machine.count({
      where: { status: { not: "revoked" }, trialEnd: { gt: new Date(), lt: new Date(Date.now() + 7 * 86400000) } },
    }),
    prisma.company.count(),
    prisma.licenseKey.count({ where: { revoked: false, machineId: null } }),
    prisma.superAdminAudit.count(),
  ]);
  const byStatus: Record<string, number> = {};
  for (const m of machines) byStatus[m.status] = m._count;
  return NextResponse.json({ byStatus, trialsExpiring, companies, poolKeys: keys, audits });
}
