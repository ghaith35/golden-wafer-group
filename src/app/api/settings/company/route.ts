import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { companyPatchSchema } from "@/lib/settings/validation";

/// Enterprise identity (name, contact, fiscal IDs, bank, logo).
/// Shown on invoices, van sheets and tickets.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const company = await prisma.company.findUnique({
    where: { id: auth.session.companyId },
  });
  if (!company) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(company);
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = companyPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const data: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    data[k] = typeof v === "string" ? (v.trim() ? v.trim() : null) : v;
  }
  const company = await prisma.company.update({
    where: { id: auth.session.companyId },
    data,
  });
  return NextResponse.json(company);
}
