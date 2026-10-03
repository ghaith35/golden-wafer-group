import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { depositSchema } from "@/lib/cash/validation";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { ensureSeasonFor } from "@/lib/docs/sequences";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await getOrCreateSettings(session.companyId);
  if (!settings.depositsEnabled) return NextResponse.json({ error: "deposits_disabled" }, { status: 400 });
  const rows = await prisma.deposit.findMany({
    where: { companyId: session.companyId },
    include: { client: { select: { id: true, name: true, code: true } } },
    orderBy: { date: "desc" },
    take: 300,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await getOrCreateSettings(session.companyId);
  if (!settings.depositsEnabled) return NextResponse.json({ error: "deposits_disabled" }, { status: 400 });
  const parsed = depositSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  const date = d.date ? new Date(d.date) : new Date();
  try {
    const season = await ensureSeasonFor(session.companyId, date);
    const row = await prisma.$transaction(async (tx) => {
      const client = await tx.customer.findFirst({ where: { id: d.clientId, companyId: session.companyId } });
      if (!client) throw Object.assign(new Error("bad_client"), { status: 400 });
      const dep = await tx.deposit.create({
        data: { companyId: session.companyId, seasonId: season.id, clientId: client.id, amount: d.amount, date, notes: d.notes ?? null },
      });
      // Advance credits the client balance (nets against future debts).
      await tx.customer.update({ where: { id: client.id }, data: { balance: { decrement: d.amount } } });
      return tx.deposit.findUniqueOrThrow({ where: { id: dep.id }, include: { client: true } });
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
