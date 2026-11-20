import { z } from "zod";

export const ruleItemSchema = z.object({
  role: z.enum(["BUY", "GIVE"]),
  productId: z.string().min(1),
  /// Quantity in colis.
  colis: z.coerce.number().finite().positive().max(100000),
});

export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mode: z.enum(["SINGLE", "PACK"]),
  isActive: z.boolean().optional(),
  items: z.array(ruleItemSchema).min(2).max(40),
});

/// PATCH: either just the active switch, or a full replacement of the rule.
export const rulePatchSchema = z.union([
  z.object({ isActive: z.boolean() }).strict(),
  ruleSchema,
]);

export type RuleInput = z.infer<typeof ruleSchema>;
