import { z } from "zod";

export const versementSchema = z.object({
  kind: z.enum(["CLIENT_PAYMENT", "SUPPLIER_PAYMENT"]),
  clientId: z.string().nullish(),
  supplierId: z.string().nullish(),
  amount: z.coerce.number().finite().positive(),
  date: z.string().nullish(),
  notes: z.string().max(500).nullish(),
  /// Till attribution (set by the caller or inferred from the collector's van).
  locationId: z.string().nullish(),
  tourneeId: z.string().nullish(),
});

export const depositSchema = z.object({
  clientId: z.string(),
  amount: z.coerce.number().finite().positive(),
  date: z.string().nullish(),
  notes: z.string().max(500).nullish(),
});

export const expenseSchema = z.object({
  typeId: z.string().nullish(),
  locationId: z.string().nullish(),
  label: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullish(),
  amount: z.coerce.number().finite().positive(),
  expenseDate: z.string().nullish(),
});
