import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/// Informational machine registration (called explicitly from activation UI).
export async function POST(req: Request) {
  const { machineId, label, phone, specs } = (await req.json().catch(() => ({}))) as {
    machineId?: string;
    label?: string;
    phone?: string;
    specs?: Record<string, unknown>;
  };
  if (!machineId || typeof machineId !== "string") return NextResponse.json({ error: "bad_machine" }, { status: 400 });
  await prisma.machine.upsert({
    where: { machineId },
    update: { label: label ?? undefined, phone: phone ?? undefined, specs: (specs ?? undefined) as never, lastSeen: new Date() },
    create: { machineId, label: label ?? null, phone: phone ?? null, specs: (specs ?? undefined) as never },
  });
  return NextResponse.json({ ok: true });
}
