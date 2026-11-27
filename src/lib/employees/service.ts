import { prisma } from "@/lib/db";
import { ensureSeasonFor } from "@/lib/docs/sequences";
import { allocateFifo, computeNet, money2 } from "./payroll";

/// Payroll service. Every call is company-scoped. Money always flows through
/// the regular `Expense` table (type "Salaires") so cash and reports stay right.

export const SALARY_TYPE_NAME = "Salaires";

export class EmployeeError extends Error {
  constructor(public code: "not_found" | "already_paid" | "already_employee" | "bad_user" | "inactive") {
    super(code);
  }
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const num = (d: unknown) => Number(d ?? 0);

async function salaryTypeId(tx: Tx, companyId: string): Promise<string> {
  const found = await tx.expenseType.findFirst({ where: { companyId, name: SALARY_TYPE_NAME } });
  if (found) {
    if (!found.isActive) await tx.expenseType.update({ where: { id: found.id }, data: { isActive: true } });
    return found.id;
  }
  return (await tx.expenseType.create({ data: { companyId, name: SALARY_TYPE_NAME } })).id;
}

async function ownedEmployee(companyId: string, employeeId: string) {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    include: { user: { select: { id: true, fullName: true, username: true } } },
  });
  if (!emp) throw new EmployeeError("not_found");
  return emp;
}

async function outstandingOf(client: Pick<Tx, "employeeAdvance">, employeeId: string) {
  const rows = await client.employeeAdvance.findMany({
    where: { employeeId, remaining: { gt: 0 } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: { id: true, remaining: true },
  });
  const list = rows.map((r) => ({ id: r.id, remaining: num(r.remaining) }));
  return { list, total: money2(list.reduce((s, a) => s + a.remaining, 0)) };
}

export type EmployeeRow = {
  userId: string;
  fullName: string;
  username: string;
  phone: string | null;
  role: string;
  userActive: boolean;
  employee: null | {
    id: string; salary: number; hireDate: string; endDate: string | null; position: string | null;
    nationalId: string | null; notes: string | null; isActive: boolean;
  };
  outstanding: number;
  paid: null | { id: string; net: number; paidAt: string; advancesDeducted: number };
};

/// Every staff user (Livreur / Vendeur) with their employee record (if any),
/// open advance balance and whether the given month is already paid.
export async function listEmployeeRows(companyId: string, year: number, month: number): Promise<EmployeeRow[]> {
  const users = await prisma.user.findMany({
    where: { companyId, role: { in: ["Livreur", "Vendeur"] } },
    orderBy: { fullName: "asc" },
    include: {
      employee: {
        include: {
          advances: { where: { remaining: { gt: 0 } }, select: { remaining: true } },
          payslips: { where: { year, month }, take: 1 },
        },
      },
    },
  });
  return users.map((u) => {
    const e = u.employee;
    const ps = e?.payslips[0];
    return {
      userId: u.id,
      fullName: u.fullName,
      username: u.username,
      phone: u.phone,
      role: u.role,
      userActive: u.isActive,
      employee: e
        ? {
            id: e.id, salary: num(e.salary), hireDate: e.hireDate.toISOString(), endDate: e.endDate?.toISOString() ?? null,
            position: e.position, nationalId: e.nationalId, notes: e.notes, isActive: e.isActive,
          }
        : null,
      outstanding: money2((e?.advances ?? []).reduce((s, a) => s + num(a.remaining), 0)),
      paid: ps ? { id: ps.id, net: num(ps.net), paidAt: ps.paidAt.toISOString(), advancesDeducted: num(ps.advancesDeducted) } : null,
    };
  });
}

type CreateInput = { userId: string; salary: number; hireDate?: string | null; position?: string | null; nationalId?: string | null; notes?: string | null };

/// The "Employee" toggle: creates the record, or re-activates a former one.
export async function enableEmployee(companyId: string, input: CreateInput) {
  const user = await prisma.user.findFirst({ where: { id: input.userId, companyId } });
  if (!user || user.role === "Admin") throw new EmployeeError("bad_user");
  const existing = await prisma.employee.findUnique({ where: { userId: user.id } });
  const data = {
    salary: money2(input.salary),
    ...(input.hireDate ? { hireDate: new Date(input.hireDate) } : {}),
    position: input.position?.trim() || null,
    nationalId: input.nationalId?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  if (existing) {
    if (existing.isActive) throw new EmployeeError("already_employee");
    return prisma.employee.update({ where: { id: existing.id }, data: { ...data, isActive: true, endDate: null } });
  }
  return prisma.employee.create({ data: { companyId, userId: user.id, ...data } });
}

type PatchInput = {
  salary?: number; hireDate?: string | null; endDate?: string | null; position?: string | null;
  nationalId?: string | null; notes?: string | null; isActive?: boolean;
};

export async function updateEmployee(companyId: string, employeeId: string, p: PatchInput) {
  await ownedEmployee(companyId, employeeId);
  return prisma.employee.update({
    where: { id: employeeId },
    data: {
      ...(p.salary !== undefined ? { salary: money2(p.salary) } : {}),
      ...(p.hireDate !== undefined ? { hireDate: p.hireDate ? new Date(p.hireDate) : new Date() } : {}),
      ...(p.endDate !== undefined ? { endDate: p.endDate ? new Date(p.endDate) : null } : {}),
      ...(p.position !== undefined ? { position: p.position?.trim() || null } : {}),
      ...(p.nationalId !== undefined ? { nationalId: p.nationalId?.trim() || null } : {}),
      ...(p.notes !== undefined ? { notes: p.notes?.trim() || null } : {}),
      ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
      // Turning the toggle off stamps the end date; turning it on clears it.
      ...(p.isActive === false && p.endDate === undefined ? { endDate: new Date() } : {}),
      ...(p.isActive === true && p.endDate === undefined ? { endDate: null } : {}),
    },
  });
}

export async function listAdvances(companyId: string, employeeId: string) {
  await ownedEmployee(companyId, employeeId);
  const rows = await prisma.employeeAdvance.findMany({
    where: { employeeId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return rows.map((a) => ({
    id: a.id, amount: num(a.amount), remaining: num(a.remaining), date: a.date.toISOString(), note: a.note,
  }));
}

/// Cash advance: one transaction → advance row + Expense.
export async function giveAdvance(companyId: string, employeeId: string, input: { amount: number; date?: string | null; note?: string | null }) {
  const emp = await ownedEmployee(companyId, employeeId);
  if (!emp.isActive) throw new EmployeeError("inactive");
  const date = input.date ? new Date(input.date) : new Date();
  const amount = money2(input.amount);
  const season = await ensureSeasonFor(companyId, date);
  return prisma.$transaction(async (tx) => {
    const typeId = await salaryTypeId(tx, companyId);
    const expense = await tx.expense.create({
      data: {
        companyId, seasonId: season.id, typeId, amount, expenseDate: date,
        label: `Avance ${emp.user.fullName}`,
        description: input.note?.trim() || null,
      },
    });
    return tx.employeeAdvance.create({
      data: { companyId, employeeId, amount, remaining: amount, date, note: input.note?.trim() || null, expenseId: expense.id },
    });
  });
}

type SlipInput = { year: number; month: number; bonus?: number; deduction?: number; deductionNote?: string | null };

/// Live preview — nothing is stored.
export async function previewPayslip(companyId: string, employeeId: string, input: SlipInput) {
  const emp = await ownedEmployee(companyId, employeeId);
  const paid = await prisma.payslip.findUnique({
    where: { employeeId_year_month: { employeeId, year: input.year, month: input.month } },
  });
  const { total } = await outstandingOf(prisma, employeeId);
  const calc = computeNet({ base: num(emp.salary), bonus: input.bonus, deduction: input.deduction, outstandingAdvances: total });
  return {
    base: num(emp.salary), bonus: input.bonus ?? 0, deduction: input.deduction ?? 0,
    outstanding: total, ...calc,
    paid: paid ? { id: paid.id, net: num(paid.net), paidAt: paid.paidAt.toISOString() } : null,
  };
}

/// Pays a month: payslip row + FIFO advance recovery + Expense, atomically.
/// The (employee, year, month) unique index makes a double payment impossible.
export async function payPayslip(companyId: string, employeeId: string, input: SlipInput) {
  const emp = await ownedEmployee(companyId, employeeId);
  if (!emp.isActive) throw new EmployeeError("inactive");
  const now = new Date();
  const season = await ensureSeasonFor(companyId, now);
  return prisma.$transaction(async (tx) => {
    const dup = await tx.payslip.findUnique({
      where: { employeeId_year_month: { employeeId, year: input.year, month: input.month } },
    });
    if (dup) throw new EmployeeError("already_paid");
    const { list, total } = await outstandingOf(tx, employeeId);
    const bonus = money2(input.bonus ?? 0);
    const deduction = money2(input.deduction ?? 0);
    const calc = computeNet({ base: num(emp.salary), bonus, deduction, outstandingAdvances: total });
    for (const a of allocateFifo(list, calc.advancesDeducted)) {
      await tx.employeeAdvance.update({ where: { id: a.id }, data: { remaining: a.remaining } });
    }
    const typeId = await salaryTypeId(tx, companyId);
    const mm = String(input.month).padStart(2, "0");
    // Advances were already booked as expenses when handed out, so only the
    // cash actually paid now (the net) is a new expense.
    const expense = calc.net > 0
      ? await tx.expense.create({
          data: {
            companyId, seasonId: season.id, typeId, amount: calc.net, expenseDate: now,
            label: `Salaire ${emp.user.fullName} ${mm}/${input.year}`,
          },
        })
      : null;
    return tx.payslip.create({
      data: {
        companyId, employeeId, year: input.year, month: input.month,
        baseSalary: money2(num(emp.salary)), bonus, deduction,
        deductionNote: input.deductionNote?.trim() || null,
        advancesDeducted: calc.advancesDeducted, net: calc.net, expenseId: expense?.id ?? null,
      },
    });
  });
}

export async function listPayslips(companyId: string, employeeId: string) {
  await ownedEmployee(companyId, employeeId);
  const rows = await prisma.payslip.findMany({ where: { employeeId }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 36 });
  return rows.map((p) => ({
    id: p.id, year: p.year, month: p.month, baseSalary: num(p.baseSalary), bonus: num(p.bonus), deduction: num(p.deduction),
    advancesDeducted: num(p.advancesDeducted), net: num(p.net), paidAt: p.paidAt.toISOString(),
  }));
}
