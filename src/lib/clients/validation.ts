import { z } from "zod";
import { isLegacyClientQr } from "./qr";

export const legacyQrSchema = z.string().trim().refine(isLegacyClientQr, "bad_legacy_qr").nullable();

const phone = z
  .string()
  .trim()
  .regex(/^(0)(5|6|7)[0-9]{8}$/, "bad_phone")
  .nullish();

export const clientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /// Phone-minted code for offline-created clients (server honors it when
  /// free). Lets the livreur print/show the QR immediately, no round-trip.
  code: z.string().trim().regex(/^CLT-[A-Z0-9-]{4,28}$/, "bad_code").nullish(),
  phone: phone,
  address: z.string().trim().max(255).nullish(),
  wilayaCode: z.number().int().min(1).max(69).nullish(),
  secteurId: z.string().nullish(),
  activityType: z.string().trim().max(60).nullish(),
  tierId: z.string().nullish(),
  creditLimit: z.coerce.number().finite().min(0).optional(),
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  gpsLat: z.coerce.number().finite().min(-90).max(90).nullish(),
  gpsLng: z.coerce.number().finite().min(-180).max(180).nullish(),
  isActive: z.boolean().optional(),
});

export type ClientInput = z.infer<typeof clientSchema>;

export const supplierPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(255).nullish(),
  wilayaCode: z.number().int().min(1).max(69).nullish(),
  secteurId: z.string().nullish(),
  notes: z.string().max(500).nullish(),
  isActive: z.boolean().optional(),
});

/// QR payload: stable, company-scoped, reprint-safe.
export function clientQrPayload(companyId: string, code: string): string {
  return `DCLT://${companyId}/${code}`;
}

/// Offline client code: unique per phone with no server round-trip.
/// Time-ordered (base36 ms) + 5 random chars — two livreurs creating clients
/// offline the same day (or same second) never mint the same code, so each
/// account QR is distinct. Never collides with sequential CLT-0001… either.
export function generateOfflineClientCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  let rand = "";
  for (const b of buf) rand += chars[b % chars.length];
  return `CLT-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

/// Portal secret: 6 unambiguous chars.
export function generatePortalSecret(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (const b of buf) s += chars[b % chars.length];
  return s;
}
