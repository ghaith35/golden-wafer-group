import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/settings/helpers";
import { payslipSchema } from "@/lib/employees/validation";
import { listPayslips, payPayslip, previewPayslip } from "@/lib/employees/service";
import { employeeErrorResponse, validationResponse } from "../../_http";

/// ?history=1 → paid payslips; otherwise a live preview for ?year&month&bonus&deduction.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("history")) return NextResponse.json(await listPayslips(auth.session.companyId, id));
    const parsed = payslipSchema.safeParse(Object.fromEntries(sp));
    if (!parsed.success) return validationResponse(parsed.error.issues);
    return NextResponse.json(await previewPayslip(auth.session.companyId, id, parsed.data));
  } catch (e) {
    return employeeErrorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = payslipSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(parsed.error.issues);
  try {
    const row = await payPayslip(auth.session.companyId, id, parsed.data);
    return NextResponse.json({ id: row.id, net: Number(row.net) }, { status: 201 });
  } catch (e) {
    return employeeErrorResponse(e);
  }
}
