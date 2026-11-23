import { z } from "zod";

export const syncOpSchema = z.object({
  opId: z.string().min(8).max(64),
  kind: z.enum(["ticket", "order", "client", "client-update", "versement", "client-return", "transfer-declare", "transfer-confirm", "transfer-reject", "stop-update", "cash-declare", "day-start", "day-finish", "expense", "expense-update", "expense-delete", "order-deliver", "sale-cancel", "sale-confirm", "sale-reopen", "client-closed"]),
  payload: z.record(z.string(), z.unknown()),
  /// Real action time on the phone (epoch ms). The server stores this instead
  /// of sync time so offline sales land on the right day.
  occurredAt: z.number().int().optional(),
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
