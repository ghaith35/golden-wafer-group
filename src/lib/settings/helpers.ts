import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function requireAdmin() {
  const session = await getSession();
  if (!session) return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.role !== "Admin")
    return { ok: false as const, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { ok: true as const, session };
}

export async function getOrCreateSettings(companyId: string) {
  return prisma.companySettings.upsert({
    where: { companyId },
    update: {},
    create: { companyId },
  });
}
