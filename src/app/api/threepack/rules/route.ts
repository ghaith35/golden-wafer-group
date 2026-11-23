import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { ruleSchema } from "@/lib/threepack/validation";
import { assertRuleValid, itemRows, listRulesForAdmin, windowData } from "@/lib/threepack/admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await listRulesForAdmin(auth.session.companyId));
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = ruleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  const companyId = auth.session.companyId;
  try {
    await assertRuleValid(companyId, parsed.data);
    const rule = await prisma.threePackRule.create({
      data: {
        companyId,
        name: parsed.data.name,
        mode: parsed.data.mode,
        percent: parsed.data.mode === "PERCENT" ? (parsed.data.percent ?? null) : null,
        isActive: parsed.data.isActive ?? true,
        ...windowData(parsed.data),
        items: { create: itemRows(parsed.data.items, parsed.data.mode) },
      },
    });
    return NextResponse.json({ id: rule.id }, { status: 201 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
