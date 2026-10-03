import { z } from "zod";

const decimal = z.coerce.number().finite().min(0);

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reference: z.string().trim().max(60).nullish(),
  barcode: z.string().trim().max(60).nullish(),
  colisage: z.string().trim().max(60).nullish(),
  categoryId: z.string().nullish(),
  supplierId: z.string().nullish(),
  baseUnitId: z.string().nullish(),
  saleUnitId: z.string().nullish(),
  purchaseUnitId: z.string().nullish(),
  minStock: decimal.optional(),
  salePrice: decimal.optional(),
  costPrice: decimal.optional(),
  isActive: z.boolean().optional(),
  images: z.array(z.string().max(255)).max(8).optional(),
  conversions: z
    .array(z.object({
      unitId: z.string(),
      factor: z.coerce.number().finite().positive(),
      barcode: z.string().trim().max(60).nullish(),
    }))
    .max(20)
    .optional(),
  tierPrices: z
    .array(z.object({ tierId: z.string(), price: decimal }))
    .max(20)
    .optional(),
});

export type ProductInput = z.infer<typeof productSchema>;

export const purchaseLineSchema = z.object({
  productId: z.string(),
  unitId: z.string().nullish(),
  qty: z.coerce.number().finite().positive(),
  freeQty: z.coerce.number().finite().min(0).optional(),
  unitPrice: z.coerce.number().finite().min(0),
  /// Optional sale price set at purchase (per line unit → stored per base).
  salePrice: z.coerce.number().finite().min(0).nullish(),
  /// Optional tier prices set at purchase (per line unit → stored per base).
  tierPrices: z
    .array(z.object({ tierId: z.string(), price: z.coerce.number().finite().min(0) }))
    .max(20)
    .optional(),
  remise: z.coerce.number().finite().min(0).optional(),
  expiryDate: z.string().nullish(),
});

export const purchaseSchema = z.object({
  supplierId: z.string(),
  locationId: z.string().nullish(),
  date: z.string().nullish(),
  remise: z.coerce.number().finite().min(0).optional(),
  /// Amount handed to the supplier with this invoice (versé).
  paid: z.coerce.number().finite().min(0).optional(),
  notes: z.string().max(500).nullish(),
  lines: z.array(purchaseLineSchema).min(1).max(200),
});

export const supplierReturnSchema = z.object({
  supplierId: z.string(),
  invoiceId: z.string().nullish(),
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
