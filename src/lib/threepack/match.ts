/// 3pack matching — PURE (no Prisma / no I/O) so the server, the web forms and
/// the offline van phone all apply the exact same rule.
///
/// A rule has BUY items (what the client must purchase) and GIVE items (the
/// free colis). Every full multiple counts: a "10 → 1" rule on 25 colis gives
/// 2; a pack of A×10 + B×10 bought 3 times gives the reward 3 times, limited by
/// the scarcest component.

import { windowState } from "@/lib/threepack/window";

/// What the rule rewards: SINGLE / PACK = free goods; PERCENT = % off the target
/// products; PRICE = target products sold at a new price. The BUY side is the
/// same for all: one product or a pack of products, each with its colis.
export type ThreePackMode = "SINGLE" | "PACK" | "PERCENT" | "PRICE";
export const isDealMode = (m: ThreePackMode): m is "PERCENT" | "PRICE" => m === "PERCENT" || m === "PRICE";

export type ThreePackRuleLite = {
  id: string;
  name: string;
  mode: ThreePackMode;
  /// PERCENT rules: % off every target product.
  percent?: number | null;
  isActive: boolean;
  /// Promotion window (ISO). Outside it the rule gives nothing, even from a
  /// phone whose cached rules are older than the end date.
  startsAt?: string | null;
  endsAt?: string | null;
  /// GIVE items are the free goods (SINGLE/PACK) or the TARGET products of a
  /// PERCENT / PRICE rule; `price` = the new price per colis (PRICE only).
  items: Array<{ role: "BUY" | "GIVE"; productId: string; colis: number; price?: number | null }>;
};

/// How a product is sold in colis: `factor` base units per colis, `unitId` the
/// unit a line must use to express colis (null = the product's base unit).
export type ColisInfo = { unitId: string | null; factor: number };

export type ColisConversion = { unitId: string; factor: number };

/// A cart / order line as seen by the matcher. `baseQty` is the quantity in
/// BASE units (qty × unit factor), computed by the caller.
export type MatchLine = { productId: string; baseQty: number; isBonus?: boolean; bonusRuleId?: string | null };

export type GiftLine = {
  ruleId: string;
  ruleName: string;
  productId: string;
  /// Unit the gift line is expressed in (the colis unit; null = base unit).
  unitId: string | null;
  /// Quantity in colis (= the line `qty`).
  colis: number;
  /// Quantity in base units (stock deduction).
  baseQty: number;
};

const EPS = 1e-6;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/// The colis of a product: the smallest conversion with factor > 1 (same
/// convention as the order sheet). Legacy products whose BASE unit is the
/// carton (pieces are 1/N conversions) have the base unit as their colis.
/// Returns null when the product has no colis at all.
export function colisOf(p: { baseUnitId: string | null; conversions: ColisConversion[] }): ColisInfo | null {
  const packs = p.conversions.filter((c) => c.unitId && Number(c.factor) > 1).sort((a, b) => Number(a.factor) - Number(b.factor));
  if (packs.length > 0) return { unitId: packs[0].unitId, factor: Number(packs[0].factor) };
  if (p.conversions.some((c) => Number(c.factor) > 0 && Number(c.factor) < 1)) {
    return { unitId: p.baseUnitId, factor: 1 };
  }
  return null;
}

/// Colis purchased per product (gift lines excluded: a gift never counts
/// toward any rule, including its own).
function boughtColis(lines: MatchLine[], colis: Record<string, ColisInfo | undefined>): Map<string, number> {
  const bought = new Map<string, number>();
  for (const l of lines) {
    if (l.isBonus) continue;
    const info = colis[l.productId];
    if (!info || !(info.factor > 0)) continue;
    bought.set(l.productId, (bought.get(l.productId) ?? 0) + Number(l.baseQty) / info.factor);
  }
  return bought;
}

/// Number of times a rule's BUY side is satisfied by what was bought.
export function ruleMultiple(rule: ThreePackRuleLite, bought: Map<string, number>): number {
  const buys = rule.items.filter((i) => i.role === "BUY");
  if (buys.length === 0) return 0;
  let times = Infinity;
  for (const b of buys) {
    if (!(b.colis > 0)) return 0;
    times = Math.min(times, Math.floor((bought.get(b.productId) ?? 0) / b.colis + EPS));
  }
  return Number.isFinite(times) && times > 0 ? times : 0;
}

/// The complete list of gift lines owed for the purchased lines. It is a pure
/// function of the purchases, so callers just recompute it on every change.
/// `includeInactive` is for validating offline sales made under a rule that was
/// switched off before the phone synced.
export function computeBonus(
  rules: ThreePackRuleLite[],
  lines: MatchLine[],
  colis: Record<string, ColisInfo | undefined>,
  opts?: { includeInactive?: boolean; now?: Date },
): GiftLine[] {
  const bought = boughtColis(lines, colis);
  const gifts: GiftLine[] = [];
  for (const rule of rules) {
    if (isDealMode(rule.mode)) continue; // price deals give no free goods
    if (!rule.isActive && !opts?.includeInactive) continue;
    if (!opts?.includeInactive && windowState(rule, opts?.now ?? new Date()) !== "live") continue;
    const times = ruleMultiple(rule, bought);
    if (times <= 0) continue;
    for (const g of rule.items.filter((i) => i.role === "GIVE")) {
      const info = colis[g.productId];
      if (!info || !(g.colis > 0)) continue;
      const qty = round3(times * g.colis);
      gifts.push({
        ruleId: rule.id,
        ruleName: rule.name,
        productId: g.productId,
        unitId: info.unitId,
        colis: qty,
        baseQty: round3(qty * info.factor),
      });
    }
  }
  return gifts;
}

/// Offline-sync guard: bonus lines claimed by a phone must not exceed what the
/// purchases in the same sale earn. Returns the offending claims (empty = ok).
export function overClaimedBonus(
  rules: ThreePackRuleLite[],
  lines: MatchLine[],
  colis: Record<string, ColisInfo | undefined>,
): Array<{ ruleId: string | null; productId: string; claimed: number; allowed: number }> {
  const owed = computeBonus(rules, lines, colis, { includeInactive: true });
  const allowed = new Map<string, number>();
  for (const g of owed) allowed.set(`${g.ruleId}|${g.productId}`, (allowed.get(`${g.ruleId}|${g.productId}`) ?? 0) + g.colis);

  const claimed = new Map<string, { ruleId: string | null; productId: string; colis: number }>();
  for (const l of lines) {
    if (!l.isBonus) continue;
    const info = colis[l.productId];
    const key = `${l.bonusRuleId ?? ""}|${l.productId}`;
    const q = info && info.factor > 0 ? Number(l.baseQty) / info.factor : Number.POSITIVE_INFINITY;
    const cur = claimed.get(key) ?? { ruleId: l.bonusRuleId ?? null, productId: l.productId, colis: 0 };
    cur.colis += q;
    claimed.set(key, cur);
  }
  const bad: Array<{ ruleId: string | null; productId: string; claimed: number; allowed: number }> = [];
  for (const [key, c] of claimed) {
    const a = allowed.get(key) ?? 0;
    if (c.colis > a + EPS) bad.push({ ruleId: c.ruleId, productId: c.productId, claimed: c.colis, allowed: a });
  }
  return bad;
}

// ─── Price deals: % off / new price on target products ───────────────────────

export type AppliedDeal = {
  ruleId: string;
  ruleName: string;
  kind: "PERCENT" | "PRICE";
  percent?: number;
  /// New price per colis (PRICE).
  pricePerColis?: number;
};

/// A sale line as the deal engine sees it. `baseQty` = qty × unit factor.
export type DealLine = {
  productId: string;
  qty: number;
  baseQty: number;
  unitPrice: number;
  remise: number;
  lineTotal: number;
  isBonus?: boolean;
  /// The seller typed this price by hand — a deal never overrides it.
  manualPrice?: boolean;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/// Every target (product → deal) of the PERCENT / PRICE rules whose BUY side is
/// satisfied by these purchases. A satisfied rule discounts ALL of each target
/// product's quantity in the sale (not per multiple).
export function computeDeals(
  rules: ThreePackRuleLite[],
  lines: MatchLine[],
  colis: Record<string, ColisInfo | undefined>,
  opts?: { now?: Date },
): Array<AppliedDeal & { productId: string }> {
  const bought = boughtColis(lines, colis);
  const out: Array<AppliedDeal & { productId: string }> = [];
  for (const rule of rules) {
    if (!isDealMode(rule.mode) || !rule.isActive) continue;
    if (windowState(rule, opts?.now ?? new Date()) !== "live") continue;
    if (ruleMultiple(rule, bought) <= 0) continue;
    for (const g of rule.items.filter((i) => i.role === "GIVE")) {
      if (rule.mode === "PERCENT") {
        const pct = Number(rule.percent ?? 0);
        if (pct > 0 && pct <= 100) out.push({ ruleId: rule.id, ruleName: rule.name, kind: "PERCENT", productId: g.productId, percent: pct });
      } else if (g.price != null && Number(g.price) >= 0) {
        out.push({ ruleId: rule.id, ruleName: rule.name, kind: "PRICE", productId: g.productId, pricePerColis: Number(g.price) });
      }
    }
  }
  return out;
}

/// One line with one deal applied (null when it cannot apply).
function dealtLine<L extends DealLine>(l: L, d: AppliedDeal, info: ColisInfo | undefined): L | null {
  if (!(l.qty > 0)) return null;
  if (d.kind === "PERCENT") {
    // Folded into the unit price (not the line "remise"), so it works whether
    // or not manual discounts are enabled and a phone-priced sale syncs as-is.
    const unitPrice = round4(l.unitPrice * (1 - (d.percent ?? 0) / 100));
    return { ...l, unitPrice, lineTotal: Math.max(0, l.qty * unitPrice - l.remise) };
  }
  if (!info || !(info.factor > 0) || d.pricePerColis == null) return null;
  const unitFactor = l.baseQty / l.qty; // base units per this line's unit
  const unitPrice = round4((d.pricePerColis / info.factor) * unitFactor);
  return { ...l, unitPrice, lineTotal: Math.max(0, l.qty * unitPrice - l.remise) };
}

/// Apply the deals to the purchased lines. PURE and shared by the server (online
/// sales) and the offline van phone, so both price a sale identically. Where
/// several deals hit one product, the cheapest result for the client wins.
/// Gift lines and hand-priced lines are left alone.
export function applyDeals<L extends DealLine>(
  rules: ThreePackRuleLite[],
  lines: L[],
  colis: Record<string, ColisInfo | undefined>,
  opts?: { now?: Date },
): Array<L & { deal?: AppliedDeal }> {
  const deals = computeDeals(rules, lines.filter((l) => !l.isBonus), colis, opts);
  if (deals.length === 0) return lines;
  return lines.map((l) => {
    if (l.isBonus || l.manualPrice) return l;
    let best: (L & { deal?: AppliedDeal }) | null = null;
    for (const d of deals) {
      if (d.productId !== l.productId) continue;
      const next = dealtLine(l, d, colis[l.productId]);
      if (next && (!best || next.lineTotal < best.lineTotal)) {
        best = { ...next, deal: { ruleId: d.ruleId, ruleName: d.ruleName, kind: d.kind, percent: d.percent, pricePerColis: d.pricePerColis } };
      }
    }
    return best ?? l;
  });
}

/// Rule-shape validation shared by the admin API and the admin form.
/// Returns an error code or null.
export function ruleShapeError(
  mode: ThreePackMode,
  items: Array<{ role: "BUY" | "GIVE"; productId: string; colis: number; price?: number | null }>,
  percent?: number | null,
): string | null {
  const buys = items.filter((i) => i.role === "BUY");
  const gives = items.filter((i) => i.role === "GIVE");
  if (items.some((i) => !i.productId || !(i.colis > 0))) return "rule_bad_qty";
  const uniq = (xs: typeof items) => new Set(xs.map((x) => x.productId)).size === xs.length;
  if (!uniq(buys) || !uniq(gives)) return "rule_duplicate_product";
  // Price deals: buy side is one product OR a pack; targets are one product OR a pack.
  if (mode === "PERCENT" || mode === "PRICE") {
    if (buys.length < 1) return "rule_needs_buy";
    if (gives.length < 1) return "rule_needs_target";
    if (mode === "PERCENT" && !(Number(percent) > 0 && Number(percent) <= 100)) return "rule_bad_percent";
    if (mode === "PRICE" && gives.some((g) => !(g.price != null && Number(g.price) >= 0))) return "rule_bad_price";
    return null;
  }
  // Single = one bought product, one free product (the SAME product or ANY other).
  if (mode === "SINGLE") {
    if (buys.length !== 1 || gives.length !== 1) return "rule_single_shape";
    return null;
  }
  if (buys.length < 2) return "rule_pack_needs_two";
  if (gives.length < 1) return "rule_needs_gift";
  return null;
}
