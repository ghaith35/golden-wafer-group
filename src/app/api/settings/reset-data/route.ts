import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/settings/helpers";
import { RESET_SCOPES, resetCounts, resetScope, type ResetScope } from "@/lib/admin/reset-data";
import { ensureMainDepot } from "@/lib/inventory/depot";
import { rateLimit } from "@/lib/rate-limit";

/// GET → how many records each reset would remove (shown before confirming).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const counts = await resetCounts(auth.session.companyId);
  return NextResponse.json({ counts });
}

/// POST { scope, password } — Admin only, password re-entered as the
/// confirmation (a stolen open session alone cannot wipe the data).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { scope?: string; password?: string };
  const scope = body.scope as ResetScope;
  if (!RESET_SCOPES.includes(scope)) return NextResponse.json({ error: "bad_scope" }, { status: 400 });
  const rl = rateLimit(`reset-data:${auth.session.userId}`, 5, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const me = await prisma.user.findFirst({ where: { id: auth.session.userId, companyId: auth.session.companyId } });
  if (!me || typeof body.password !== "string" || !(await bcrypt.compare(body.password, me.passwordHash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 403 });
  }
  try {
    const { backup } = await resetScope(auth.session.companyId, scope);
    await ensureMainDepot(auth.session.companyId).catch(() => {});
    return NextResponse.json({ ok: true, backup });
  } catch {
    return NextResponse.json({ error: "reset_failed" }, { status: 500 });
  }
}
