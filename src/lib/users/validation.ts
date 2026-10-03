import { z } from "zod";

export const userSchema = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(6).max(100),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullish(),
  role: z.enum(["Admin", "Vendeur", "Livreur"]),
  vanId: z.string().nullish(),
  isActive: z.boolean().optional(),
});

export const userPatchSchema = z.object({
  password: z.string().min(6).max(100).optional(),
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).nullish(),
  role: z.enum(["Admin", "Vendeur", "Livreur"]).optional(),
  vanId: z.string().nullish(),
  isActive: z.boolean().optional(),
});
