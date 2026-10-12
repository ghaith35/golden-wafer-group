import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ticketSchema } from "@/lib/sales/validation";
import { createTicket } from "@/lib/sales/service";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Mandob (Vendeur): orders only — ticket creation is Admin/Livreur.
  if (session.role === "Vendeur") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = ticketSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    const row = await createTicket(session.companyId, session.userId, parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
