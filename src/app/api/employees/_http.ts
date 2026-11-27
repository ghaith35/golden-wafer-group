import { NextResponse } from "next/server";
import { EmployeeError } from "@/lib/employees/service";

const STATUS: Record<EmployeeError["code"], number> = {
  not_found: 404, already_paid: 409, already_employee: 409, bad_user: 400, inactive: 409,
};

/// Maps service errors to JSON responses; anything else is rethrown.
export function employeeErrorResponse(e: unknown): NextResponse {
  if (e instanceof EmployeeError) return NextResponse.json({ error: e.code }, { status: STATUS[e.code] });
  throw e;
}

export function validationResponse(issues: unknown) {
  return NextResponse.json({ error: "validation_error", issues }, { status: 400 });
}
