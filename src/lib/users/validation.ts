import { z } from "zod";

/// Admin-assigned zones: whole wilayas + individual secteurs (empty = everything).
export const areasSchema = z.object({
  wilayas: z.array(z.number().int().min(1).max(100)).max(100),
  secteurs: z.array(z.string().min(1)).max(2000),
});

export const userSchema = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(6).max(100),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullish(),
  role: z.enum(["Admin", "Vendeur", "Livreur"]),
  vanId: z.string().nullish(),
  isActive: z.boolean().optional(),
  areas: areasSchema.nullish(),
});

export const userPatchSchema = z.object({
  password: z.string().min(6).max(100).optional(),
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullish(),
  role: z.enum(["Admin", "Vendeur", "Livreur"]).optional(),
  vanId: z.string().nullish(),
  isActive: z.boolean().optional(),
  areas: areasSchema.nullish(),
});
