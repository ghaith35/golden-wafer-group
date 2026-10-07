import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit, clientIp } from "@/lib/superadmin/session";
import { generateActivationKey } from "@/lib/license/sign";

/// List machines with subscription + key state (newest activity first).
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const q = (sp.get("q") ?? "").trim();
  const rows = await prisma.machine.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { machineId: { contains: q } },
              { label: { contains: q } },
              { workshop: { contains: q } },
              { contactName: { contains: q } },
              { phone: { contains: q } },
              { email: { contains: q } },
            ],
          }
        : {}),
    },
    include: { subscription: true },
    orderBy: { lastSeen: "desc" },
    take: 500,
  });
  return NextResponse.json(rows);
}

/// Manual add (repaire parity): a customer sends their Machine ID over
/// WhatsApp without ever starting a trial. Creates a pending row the vendor
/// can then activate. Idempotent: re-adding only refreshes the label.
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { machineId, label } = (await req.json().catch(() => ({}))) as {
    machineId?: string;
    label?: string;
  };
  const id = (machineId ?? "").trim();
  if (!id || id.length > 200) return NextResponse.json({ error: "bad_machine" }, { status: 400 });
  const row = await prisma.machine.upsert({
    where: { machineId: id },
    update: { label: label?.trim() || undefined },
    create: {
      machineId: id,
      label: label?.trim() || null,
      status: "pending",
      activationKey: generateActivationKey(),
      activationType: "machine",
    },
  });
  await audit(auth.admin.adminId, "machine_added", "machine", id, { label }, clientIp(req) ?? undefined);
  return NextResponse.json(row, { status: 201 });
}
