import { z } from "zod";

export const saleLineSchema = z.object({
  productId: z.string(),
  unitId: z.string().nullish(),
  qty: z.coerce.number().finite().positive(),
  /// If omitted, resolved from tier price (client tier or chosen tier) or salePrice.
  unitPrice: z.coerce.number().finite().min(0).nullish(),
  remise: z.coerce.number().finite().min(0).optional(),
  /// 3pack gift line. Only the offline van phone sends it (the server computes
  /// gifts itself for online sales and strips anything sent).
  bonusRuleId: z.string().nullish(),
});

export const orderSchema = z.object({
  clientId: z.string(),
  tierId: z.string().nullish(),
  locationId: z.string().nullish(),
  channel: z.enum(["VAN", "POS", "DEPOT"]).optional(),
  remise: z.coerce.number().finite().min(0).optional(),
  paid: z.coerce.number().finite().min(0).optional(),
  notes: z.string().max(500).nullish(),
  tourneeId: z.string().nullish(),
  lines: z.array(saleLineSchema).min(1).max(200),
});

export const ticketSchema = z.object({
  clientId: z.string().nullish(),
  locationId: z.string(),
  tierId: z.string().nullish(),
  channel: z.enum(["VAN", "POS", "DEPOT"]).optional(),
  qrScanned: z.boolean().optional(),
  tourneeId: z.string().nullish(),
  remise: z.coerce.number().finite().min(0).optional(),
  paid: z.coerce.number().finite().min(0).nullish(),
  notes: z.string().max(500).nullish(),
  /// Silent sale-site fix from the phone (van tickets): never required,
  /// stripped to null when out of range — the sale must never fail on it.
  saleLat: z.coerce.number().finite().nullish(),
  saleLng: z.coerce.number().finite().nullish(),
  lines: z.array(saleLineSchema).min(1).max(200),
});

export const deliverSchema = z.object({
  locationId: z.string(),
  paid: z.coerce.number().finite().min(0).optional(),
});

export const clientReturnSchema = z.object({
  clientId: z.string(),
  saleId: z.string().nullish(),
  locationId: z.string(),
  refundType: z.enum(["CASH", "DEBT_CREDIT"]),
  notes: z.string().max(500).nullish(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        baseQty: z.coerce.number().finite().positive(),
        unitPrice: z.coerce.number().finite().min(0),
      })
    )
    .min(1)
    .max(200),
});

export const tourneeSchema = z.object({
  date: z.string(),
  locationId: z.string(),
  secteurId: z.string().nullish(),
  notes: z.string().max(500).nullish(),
  clientIds: z.array(z.string()).max(500).optional(),
  /// Admin planning: make this a recurring tour — every week or every 2 weeks,
  /// with no end date. Omitted = a one-off tour for `date` only.
  frequency: z.enum(["WEEKLY", "BIWEEKLY"]).optional(),
});

export const tourneeStopsSchema = z.object({
  clientIds: z.array(z.string()).max(500),
});

export const stopUpdateSchema = z.object({
  visited: z.boolean().optional(),
  sold: z.boolean().optional(),
  skipped: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});
