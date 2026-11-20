import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getOrCreateSettings } from "@/lib/settings/helpers";
import { loadColis, loadRules } from "@/lib/threepack/service";
import { prisma } from "@/lib/db";

/// Active rules for the order / POS forms (any logged-in user: sellers need the
/// rules to preview the gift live). The server still recomputes on save.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await getOrCreateSettings(session.companyId);
  if (!settings.threePackEnabled) return NextResponse.json({ enabled: false, rules: [], colis: {}, names: {} });
  const rules = await loadRules(session.companyId);
  const ids = [...new Set(rules.flatMap((r) => r.items.map((i) => i.productId)))];
  const [colis, products] = await Promise.all([
    loadColis(session.companyId, ids),
    ids.length ? prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return NextResponse.json({ enabled: true, rules, colis, names: Object.fromEntries(products.map((p) => [p.id, p.name])) });
}
