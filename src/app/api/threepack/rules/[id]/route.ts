import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { rulePatchSchema } from "@/lib/threepack/validation";
import { replaceRule } from "@/lib/threepack/admin";

type Ctx = { params: Promise<{ id: string }> };

/// PATCH: `{ isActive }` toggles the rule; a full body edits it (see replaceRule:
/// a change to products/quantities creates a NEW rule version, never mutates).
/// Past sales keep their gift lines either way (the lines are plain sale lines).
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const companyId = auth.session.companyId;
  const rule = await prisma.threePackRule.findFirst({ where: { id, companyId, isArchived: false } });
  if (!rule) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = rulePatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  try {
    if ("items" in parsed.data) {
      const r = await replaceRule(companyId, id, parsed.data);
      return NextResponse.json({ ok: true, id: r.id, versioned: r.versioned });
    }
    await prisma.threePackRule.update({ where: { id }, data: { isActive: parsed.data.isActive } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

/// "Delete" only deactivates: offline sales reference the rule id until they sync.
export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const rule = await prisma.threePackRule.findFirst({ where: { id, companyId: auth.session.companyId, isArchived: false } });
  if (!rule) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.threePackRule.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
