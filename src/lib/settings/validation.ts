import { z } from "zod";

export const settingsPatchSchema = z.object({
  defaultLocale: z.enum(["ar", "fr", "en"]).optional(),
  currency: z.string().min(1).max(8).optional(),
  expiryEnabled: z.boolean().optional(),
  creditSalesEnabled: z.boolean().optional(),
  debtTrackingEnabled: z.boolean().optional(),
  remiseEnabled: z.boolean().optional(),
  depositsEnabled: z.boolean().optional(),
  multiDepotEnabled: z.boolean().optional(),
  costingMethod: z.enum(["LAST", "AVERAGE", "FIFO"]).optional(),
  facturePro: z.boolean().optional(),
  posEnabled: z.boolean().optional(),
  vanBindingMode: z.enum(["LOCKED", "PICK"]).optional(),
  oversellAllowed: z.boolean().optional(),
  pieceSalesEnabled: z.boolean().optional(),
  transferConfirmRequired: z.boolean().optional(),
  qrStrictMode: z.boolean().optional(),
  gpsEnabled: z.boolean().optional(),
  ticketWidth: z.enum(["58", "80"]).optional(),
  ticketLang: z.enum(["ar", "fr"]).optional(),
  supplierFilterEnabled: z.boolean().optional(),
  workStartAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
  maxDayHours: z.coerce.number().finite().min(1).max(24).nullish(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const companyPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(255).nullish(),
  email: z.string().trim().max(120).nullish(),
  rc: z.string().trim().max(60).nullish(),
  nif: z.string().trim().max(60).nullish(),
  ai: z.string().trim().max(60).nullish(),
  nis: z.string().trim().max(60).nullish(),
  bankName: z.string().trim().max(120).nullish(),
  rib: z.string().trim().max(60).nullish(),
  logoUrl: z.string().trim().max(255).nullish(),
  signatureUrl: z.string().trim().max(255).nullish(),
  stampUrl: z.string().trim().max(255).nullish(),
});

export type CompanyPatch = z.infer<typeof companyPatchSchema>;

export const refItemSchema = z.object({
  name: z.string().trim().min(1).max(60),
  symbol: z.string().trim().max(12).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

export const secteurSchema = z.object({
  wilayaCode: z.number().int().min(1).max(69),
  name: z.string().trim().min(1).max(60),
  isActive: z.boolean().optional(),
});
