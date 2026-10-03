import { z } from "zod";

export const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(255).nullish(),
  kind: z.enum(["DEPOT", "VAN"]),
  marque: z.string().trim().max(60).nullish(),
  matricule: z.string().trim().max(30).nullish(),
  imageUrl: z.string().trim().max(255).nullish(),
  userId: z.string().nullish(),
  isActive: z.boolean().optional(),
});

export const transferLineSchema = z.object({
  productId: z.string(),
  qty: z.coerce.number().finite().positive(),
});

export const transferSchema = z.object({
  fromLocationId: z.string(),
  toLocationId: z.string(),
  cashAmount: z.coerce.number().finite().min(0).optional(),
  notes: z.string().max(500).nullish(),
  lines: z.array(transferLineSchema).min(1).max(200),
});

export const transferConfirmSchema = z.object({
  action: z.enum(["confirm", "reject", "cancel"]),
  lines: z.array(z.object({ lineId: z.string(), confirmedQty: z.coerce.number().finite().min(0) })).optional(),
});

export const countSchema = z.object({
  locationId: z.string(),
  notes: z.string().max(500).nullish(),
  lines: z
    .array(z.object({ productId: z.string(), countedQty: z.coerce.number().finite().min(0) }))
    .min(1)
    .max(500),
});

export const lossSchema = z.object({
  locationId: z.string(),
  productId: z.string(),
  baseQty: z.coerce.number().finite().positive(),
  motive: z.enum(["BREAKAGE", "EXPIRED", "GIFT", "LOSS", "OTHER"]),
  notes: z.string().max(500).nullish(),
});
