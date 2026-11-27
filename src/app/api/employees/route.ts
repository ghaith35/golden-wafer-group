import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/settings/helpers";
import { employeeCreateSchema } from "@/lib/employees/validation";
import { enableEmployee, listEmployeeRows } from "@/lib/employees/service";
import { employeeErrorResponse, validationResponse } from "./_http";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const year = Number(sp.get("year")) || now.getFullYear();
  const month = Number(sp.get("month")) || now.getMonth() + 1;
  return NextResponse.json(await listEmployeeRows(auth.session.companyId, year, month));
}

/// The "Employee" toggle: put a staff user on the payroll.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = employeeCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(parsed.error.issues);
  try {
    const row = await enableEmployee(auth.session.companyId, parsed.data);
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    return employeeErrorResponse(e);
  }
}
