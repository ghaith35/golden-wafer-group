import { prisma } from "@/lib/db";
import {
  colisOf,
  computeBonus,
  overClaimedBonus,
  type ColisInfo,
  type ThreePackRuleLite,
} from "@/lib/threepack/match";

/// Minimal shape of a priced sale line (structurally matches `PricedLine` in
/// sales/service.ts, kept local to avoid a circular import).
export type GiftCapableLine = {
  productId: string;
  unitId: string | null;
  qty: number;
  baseQty: number;
  unitPrice: number;
  remise: number;
  lineTotal: number;
  isBonus?: boolean;
  bonusRuleId?: string | null;
};

/// Active (or all) rules of a company in the matcher's plain shape.
export async function loadRules(companyId: string, opts?: { includeInactive?: boolean }): Promise<ThreePackRuleLite[]> {
  const rows = await prisma.threePackRule.findMany({
    where: { companyId, ...(opts?.includeInactive ? {} : { isActive: true }) },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode as "SINGLE" | "PACK",
    isActive: r.isActive,
    items: r.items.map((i) => ({ role: i.role as "BUY" | "GIVE", productId: i.productId, colis: Number(i.colis) })),
  }));
}

/// Colis info (unit + base units per colis) for the given products.
export async function loadColis(companyId: string, productIds: string[]): Promise<Record<string, ColisInfo | undefined>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return {};
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, baseUnitId: true, conversions: { select: { unitId: true, factor: true } } },
  });
  const out: Record<string, ColisInfo | undefined> = {};
  for (const p of products) {
    out[p.id] = colisOf({ baseUnitId: p.baseUnitId, conversions: p.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) })) }) ?? undefined;
  }
  return out;
}

/// The server is the authority on gifts, so a client can never mint free goods.
///
///  • Online (web order form, POS, admin edit): any bonus line sent is dropped
///    and the gift is recomputed from the ACTIVE rules, then appended at price 0.
///    With the feature off, no gift is added.
///  • Offline sync (`fromSync`): the phone already handed the goods over, so
///    its bonus lines are honoured — but capped to what the purchases in the
///    same sale earn (rules may have been deactivated since). Over-claims throw
///    `bonus_not_earned`.
///
/// Gift lines are ordinary sale lines at price 0, so stock deduction, cancel /
/// restore, invoices and prints need no special handling.
export async function applyThreePack<L extends GiftCapableLine>(
  companyId: string,
  settings: { threePackEnabled?: boolean | null },
  priced: L[],
  opts: { fromSync: boolean },
): Promise<L[]> {
  const enabled = !!settings.threePackEnabled;

  if (opts.fromSync) {
    if (!priced.some((l) => l.isBonus)) return priced;
    const rules = await loadRules(companyId, { includeInactive: true });
    const colis = await loadColis(companyId, [...priced.map((l) => l.productId), ...rules.flatMap((r) => r.items.map((i) => i.productId))]);
    const bad = overClaimedBonus(rules, priced.map((l) => ({ productId: l.productId, baseQty: l.baseQty, isBonus: l.isBonus, bonusRuleId: l.bonusRuleId })), colis);
    if (bad.length > 0) throw Object.assign(new Error("bonus_not_earned"), { status: 400 });
    return priced;
  }

  const purchased = priced.filter((l) => !l.isBonus);
  if (!enabled) return purchased;
  const rules = await loadRules(companyId);
  if (rules.length === 0) return purchased;

  const colis = await loadColis(companyId, [...purchased.map((l) => l.productId), ...rules.flatMap((r) => r.items.map((i) => i.productId))]);
  const gifts = computeBonus(rules, purchased.map((l) => ({ productId: l.productId, baseQty: l.baseQty })), colis);
  const giftLines = gifts.map(
    (g) =>
      ({
        productId: g.productId,
        unitId: g.unitId,
        qty: g.colis,
        baseQty: g.baseQty,
        unitPrice: 0,
        remise: 0,
        lineTotal: 0,
        isBonus: true,
        bonusRuleId: g.ruleId,
      }) as L,
  );
  return [...purchased, ...giftLines];
}
