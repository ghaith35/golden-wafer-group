import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { declareCash, remitCash, closeDay, reopenDay } from "@/lib/cash/daily";

const declareSchema = z.object({
  vanId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().finite().min(0),
  notes: z.string().max(500).nullish(),
});

/// Livreur counted his till (or admin on his behalf).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = declareSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 400 });
  const d = parsed.data;
  try {
    const row = await declareCash(session.companyId, session.userId, session.role, d.vanId, d.date, d.amount, d.notes);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
