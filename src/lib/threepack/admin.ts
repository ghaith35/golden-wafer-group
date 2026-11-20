import { prisma } from "@/lib/db";
import { loadColis } from "@/lib/threepack/service";
import { ruleShapeError } from "@/lib/threepack/match";
import type { RuleInput } from "@/lib/threepack/validation";

/// Shape + product checks for a rule being created/edited. Throws a coded
/// error (status 400) the UI maps through the `errors` namespace.
export async function assertRuleValid(companyId: string, input: RuleInput): Promise<void> {
  const shape = ruleShapeError(input.mode, input.items);
  if (shape) throw Object.assign(new Error(shape), { status: 400 });
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const found = await prisma.product.count({ where: { id: { in: ids }, companyId } });
  if (found !== ids.length) throw Object.assign(new Error("rule_bad_product"), { status: 400 });
  const colis = await loadColis(companyId, ids);
  if (ids.some((id) => !colis[id])) throw Object.assign(new Error("rule_no_colis"), { status: 400 });
}

/// Rules for the admin screen: items with product name + first photo, and how
/// many free colis each rule has actually given (cancelled sales excluded).
/// Archived versions (replaced by an edit) stay in the DB for offline sync
/// validation but are not listed.
export async function listRulesForAdmin(companyId: string) {
  const rules = await prisma.threePackRule.findMany({
    where: { companyId, isArchived: false },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } } },
        },
      },
    },
  });
  const given = rules.length
    ? await prisma.saleLine.groupBy({
        by: ["bonusRuleId"],
        where: { isBonus: true, bonusRuleId: { in: rules.map((r) => r.id) }, sale: { status: { not: "CANCELLED" } } },
        _sum: { qty: true },
      })
    : [];
  const givenBy = new Map(given.map((g) => [g.bonusRuleId, Number(g._sum.qty ?? 0)]));
  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    isActive: r.isActive,
    givenColis: givenBy.get(r.id) ?? 0,
    items: r.items.map((i) => ({
      id: i.id,
      role: i.role,
      productId: i.productId,
      productName: i.product.name,
      imageUrl: i.product.images[0]?.url ?? null,
      colis: Number(i.colis),
    })),
  }));
}

const itemsKey = (items: Array<{ role: string; productId: string; colis: unknown }>) =>
  items.map((i) => `${i.role}|${i.productId}|${Number(i.colis)}`).sort().join(",");

/// Edit a rule. Rules are IMMUTABLE once created: changing the mode, products
/// or quantities archives the old row and creates a new one (new id). A van
/// phone that sold offline under the old rule syncs later with the old rule id,
/// and the server validates it against exactly that rule — never against the
/// edited one (which would reject a sale whose goods were already handed over).
/// A name-only edit updates in place (the name never affects the maths).
export async function replaceRule(companyId: string, id: string, input: RuleInput): Promise<{ id: string; versioned: boolean }> {
  const rule = await prisma.threePackRule.findFirst({ where: { id, companyId, isArchived: false }, include: { items: true } });
  if (!rule) throw Object.assign(new Error("not_found"), { status: 404 });
  await assertRuleValid(companyId, input);
  const isActive = input.isActive ?? rule.isActive;

  if (rule.mode === input.mode && itemsKey(rule.items) === itemsKey(input.items)) {
    await prisma.threePackRule.update({ where: { id }, data: { name: input.name, isActive } });
    return { id, versioned: false };
  }
  const created = await prisma.$transaction(async (tx) => {
    await tx.threePackRule.update({ where: { id }, data: { isActive: false, isArchived: true } });
    return tx.threePackRule.create({
      data: {
        companyId,
        name: input.name,
        mode: input.mode,
        isActive,
        items: { create: input.items.map((i) => ({ role: i.role, productId: i.productId, colis: i.colis })) },
      },
    });
  });
  return { id: created.id, versioned: true };
}
