import { prisma } from "@/lib/db";
import { loadColis, expireRules } from "@/lib/threepack/service";
import { dayStart, dayEnd } from "@/lib/threepack/window";
import { ruleShapeError } from "@/lib/threepack/match";
import type { RuleInput } from "@/lib/threepack/validation";

/// Shape + product checks for a rule being created/edited. Throws a coded
/// error (status 400) the UI maps through the `errors` namespace.
export async function assertRuleValid(companyId: string, input: RuleInput): Promise<void> {
  const shape = ruleShapeError(input.mode, input.items, input.percent);
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
  await expireRules(companyId);
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
    percent: r.percent != null ? Number(r.percent) : null,
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
    givenColis: givenBy.get(r.id) ?? 0,
    items: r.items.map((i) => ({
      id: i.id,
      role: i.role,
      productId: i.productId,
      productName: i.product.name,
      imageUrl: i.product.images[0]?.url ?? null,
      colis: Number(i.colis),
      price: i.price != null ? Number(i.price) : null,
    })),
  }));
}

/// Window columns from the form's "YYYY-MM-DD" fields (undefined = untouched).
export function windowData(input: { startsOn?: string | null; endsOn?: string | null }) {
  const out: { startsAt?: Date | null; endsAt?: Date | null } = {};
  if (input.startsOn !== undefined) out.startsAt = input.startsOn ? dayStart(input.startsOn) : null;
  if (input.endsOn !== undefined) out.endsAt = input.endsOn ? dayEnd(input.endsOn) : null;
  return out;
}

const itemsKey = (items: Array<{ role: string; productId: string; colis: unknown; price?: unknown }>) =>
  items.map((i) => `${i.role}|${i.productId}|${Number(i.colis)}|${i.price == null ? "" : Number(i.price)}`).sort().join(",");

/// Item rows for create(): quantities in colis, PRICE targets carry their price.
export const itemRows = (items: RuleInput["items"], mode: RuleInput["mode"]) =>
  items.map((i) => ({ role: i.role, productId: i.productId, colis: i.colis, price: mode === "PRICE" && i.role === "GIVE" ? (i.price ?? null) : null }));

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
  const win = windowData(input);
  let isActive = input.isActive ?? rule.isActive;
  // Moving an expired rule's end date into the future (or clearing it) brings
  // it back: the auto-deactivation was only because of the old date.
  if (input.isActive === undefined && !rule.isActive && rule.endsAt && rule.endsAt.getTime() < Date.now()) {
    const ne = win.endsAt === undefined ? rule.endsAt : win.endsAt;
    if (!ne || ne.getTime() >= Date.now()) isActive = true;
  }

  const pctSame = Number(rule.percent ?? 0) === Number(input.mode === "PERCENT" ? (input.percent ?? 0) : 0);
  if (rule.mode === input.mode && pctSame && itemsKey(rule.items) === itemsKey(itemRows(input.items, input.mode))) {
    await prisma.threePackRule.update({ where: { id }, data: { name: input.name, isActive, ...win } });
    return { id, versioned: false };
  }
  const created = await prisma.$transaction(async (tx) => {
    await tx.threePackRule.update({ where: { id }, data: { isActive: false, isArchived: true } });
    return tx.threePackRule.create({
      data: {
        companyId,
        name: input.name,
        mode: input.mode,
        percent: input.mode === "PERCENT" ? (input.percent ?? null) : null,
        isActive,
        ...(win.startsAt === undefined ? { startsAt: rule.startsAt } : { startsAt: win.startsAt }),
        ...(win.endsAt === undefined ? { endsAt: rule.endsAt } : { endsAt: win.endsAt }),
        items: { create: itemRows(input.items, input.mode) },
      },
    });
  });
  return { id: created.id, versioned: true };
}
