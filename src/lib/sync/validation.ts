import { z } from "zod";

export const syncOpSchema = z.object({
  opId: z.string().min(8).max(64),
  kind: z.enum(["ticket", "order", "client", "versement", "client-return", "transfer-declare", "transfer-confirm", "stop-update", "cash-declare"]),
  payload: z.record(z.string(), z.unknown()),
});

export const syncSchema = z.object({
  deviceToken: z.string().min(8),
  locationId: z.string().nullish(),
  ops: z.array(syncOpSchema).max(200).optional(),
});

export const deviceSchema = z.object({
  label: z.string().trim().min(1).max(80),
  locationId: z.string().nullish(),
  userId: z.string().nullish(),
});

export function newDeviceToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
