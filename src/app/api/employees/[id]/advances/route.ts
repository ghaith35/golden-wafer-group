import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/settings/helpers";
import { advanceSchema } from "@/lib/employees/validation";
import { giveAdvance, listAdvances } from "@/lib/employees/service";
import { employeeErrorResponse, validationResponse } from "../../_http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json(await listAdvances(auth.session.companyId, id));
  } catch (e) {
    return employeeErrorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = advanceSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(parsed.error.issues);
  try {
    const row = await giveAdvance(auth.session.companyId, id, parsed.data);
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    return employeeErrorResponse(e);
  }
}
