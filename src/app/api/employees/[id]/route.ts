import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/settings/helpers";
import { employeePatchSchema } from "@/lib/employees/validation";
import { updateEmployee } from "@/lib/employees/service";
import { employeeErrorResponse, validationResponse } from "../_http";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = employeePatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(parsed.error.issues);
  try {
    await updateEmployee(auth.session.companyId, id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return employeeErrorResponse(e);
  }
}
