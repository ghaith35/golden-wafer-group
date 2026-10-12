import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";

/// Vendor client deployments: each sold version with its subdomain.
/// POST {client, version, domain?, machineId?} → `pending` row for the
/// provision worker. Default domain: <client>.distribuili.khiatadz.com.
/// The primary `domain` is vendor-only afterwards (never returned here).
export async function GET() {
  const su = await requireSuperAdmin();
  if (!su.ok) return su.response;
  const rows = await prisma.clientDeployment.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { tunnelSlot: { select: { id: true, subdomain: true, domain: true, status: true } } },
  });
  return NextResponse.json({ rows });
}

const CLIENT_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

export async function POST(req: Request) {
  const su = await requireSuperAdmin();
  if (!su.ok) return su.response;
  const { client, machineId, notes } = (await req.json().catch(() => ({}))) as {
    client?: string;
    machineId?: string;
    notes?: string;
  };
  const c = String(client ?? "").trim().toLowerCase();
  if (!CLIENT_RE.test(c)) return NextResponse.json({ error: "bad_client" }, { status: 400 });
  const d = String("").trim().toLowerCase() || `${c}.khiatadz.com`;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return NextResponse.json({ error: "bad_domain" }, { status: 400 });
  const dupe = await prisma.clientDeployment.findFirst({
    where: { OR: [{ client: c }, { domain: d }] },
  });
  if (dupe) return NextResponse.json({ error: "already_exists" }, { status: 409 });
  const row = await prisma.clientDeployment.create({
    data: {
      client: c, version: "", domain: d,
      machineId: machineId?.trim() || null,
      notes: notes?.trim().slice(0, 500) || null,
      status: "pending",
    },
  });
  await audit(su.admin.adminId, "deployment_created", "deployment", row.id, { client: c, domain: d }, clientIp(req) ?? undefined);
  return NextResponse.json(row, { status: 201 });
}
