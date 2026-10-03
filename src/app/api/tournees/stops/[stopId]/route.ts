import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { stopUpdateSchema } from "@/lib/sales/validation";
import { updateStop } from "@/lib/tournees/service";

export async function PATCH(req: Request, { params }: { params: Promise<{ stopId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = stopUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    const row = await updateStop(session.companyId, (await params).stopId, parsed.data);
    return NextResponse.json(row);
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
