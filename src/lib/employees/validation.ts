import { z } from "zod";

const money = z.coerce.number().finite().min(0).max(100_000_000);

export const employeeCreateSchema = z.object({
  userId: z.string().min(1),
  salary: money.default(0),
  hireDate: z.string().nullish(),
  position: z.string().trim().max(80).nullish(),
  nationalId: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const employeePatchSchema = z.object({
  salary: money.optional(),
  hireDate: z.string().nullish(),
  endDate: z.string().nullish(),
  position: z.string().trim().max(80).nullish(),
  nationalId: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});

export const advanceSchema = z.object({
  amount: z.coerce.number().finite().positive().max(100_000_000),
  date: z.string().nullish(),
  note: z.string().trim().max(200).nullish(),
});

export const payslipSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  bonus: money.default(0),
  deduction: money.default(0),
  deductionNote: z.string().trim().max(200).nullish(),
});
