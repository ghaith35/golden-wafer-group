import { z } from "zod";

export const ruleItemSchema = z.object({
  role: z.enum(["BUY", "GIVE"]),
  productId: z.string().min(1),
  /// Quantity in colis.
  colis: z.coerce.number().finite().positive().max(100000),
  /// PRICE rules, target (GIVE) items: new price per colis.
  price: z.coerce.number().finite().min(0).max(100000000).nullish(),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    mode: z.enum(["SINGLE", "PACK", "PERCENT", "PRICE"]),
    /// PERCENT rules: % off the target products (0 < p ≤ 100).
    percent: z.coerce.number().finite().gt(0).max(100).nullish(),
    isActive: z.boolean().optional(),
    /// Promotion window, "YYYY-MM-DD" (inclusive). Empty / null = open-ended.
    startsOn: ymd.nullable().optional(),
    endsOn: ymd.nullable().optional(),
    items: z.array(ruleItemSchema).min(2).max(40), // every rule has ≥1 buy and ≥1 reward/target item
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn, { path: ["endsOn"], message: "rule_bad_dates" });

/// PATCH: either just the active switch, or a full replacement of the rule.
export const rulePatchSchema = z.union([
  z.object({ isActive: z.boolean() }).strict(),
  ruleSchema,
]);

export type RuleInput = z.infer<typeof ruleSchema>;
