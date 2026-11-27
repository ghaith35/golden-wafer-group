import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Payroll end to end on the offline (SQLite) engine: advances and payslips
// book regular Expense rows, advances are recovered FIFO, a month can't be
// paid twice, and companies are isolated.

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), "distribuili-emp-e2e-"));
const dbFile = join(root, "e2e.db");

type Svc = typeof import("@/lib/employees/service");
type Db = typeof import("@/lib/db");
let svc: Svc, prisma: Db["prisma"];
const ids = { co: "", other: "", driver: "", seller: "", admin: "", emp: "" };

beforeAll(async () => {
  const Database = require("libsql");
  const d = new Database(dbFile);
  d.exec(readFileSync(resolve(__dirname, "../../prisma/sqlite-init.sql"), "utf8"));
  d.close();
  process.env.DISTRIBUILI_DB = "local";
  process.env.DISTRIBUILI_SQLITE_URL = `file:${dbFile}`;
  process.env.DISTRIBUILI_SQLITE_CLIENT = resolve(__dirname, "../../src/generated/prisma-sqlite");
  prisma = (await import("@/lib/db")).prisma;
  svc = await import("@/lib/employees/service");

  ids.co = (await prisma.company.create({ data: { name: "Emp Co" } })).id;
  ids.other = (await prisma.company.create({ data: { name: "Other Co" } })).id;
  const mk = (companyId: string, username: string, role: "Admin" | "Livreur" | "Vendeur") =>
    prisma.user.create({ data: { companyId, username, passwordHash: "x", fullName: `Name ${username}`, role } }).then((u) => u.id);
  ids.driver = await mk(ids.co, "driver", "Livreur");
  ids.seller = await mk(ids.co, "seller", "Vendeur");
  ids.admin = await mk(ids.co, "boss", "Admin");
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

const sumExpenses = async (companyId: string) =>
  Number((await prisma.expense.aggregate({ where: { companyId, deletedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0);

describe("employees (SQLite e2e)", () => {
  it("only staff can be employees; the toggle creates the record", async () => {
    await expect(svc.enableEmployee(ids.co, { userId: ids.admin, salary: 1 })).rejects.toMatchObject({ code: "bad_user" });
    await expect(svc.enableEmployee(ids.other, { userId: ids.driver, salary: 1 })).rejects.toMatchObject({ code: "bad_user" });
    const e = await svc.enableEmployee(ids.co, { userId: ids.driver, salary: 50000, position: "Driver" });
    ids.emp = e.id;
    await expect(svc.enableEmployee(ids.co, { userId: ids.driver, salary: 1 })).rejects.toMatchObject({ code: "already_employee" });
    const rows = await svc.listEmployeeRows(ids.co, 2026, 11);
    expect(rows.map((r) => [r.username, !!r.employee])).toEqual([["driver", true], ["seller", false]]);
  });

  it("an advance books an expense and shows as outstanding", async () => {
    await svc.giveAdvance(ids.co, ids.emp, { amount: 10000, date: "2026-11-05T10:00:00Z" });
    await svc.giveAdvance(ids.co, ids.emp, { amount: 15000, date: "2026-11-10T10:00:00Z", note: "rent" });
    expect(await sumExpenses(ids.co)).toBe(25000);
    const type = await prisma.expenseType.findFirst({ where: { companyId: ids.co } });
    expect(type?.name).toBe(svc.SALARY_TYPE_NAME);
    const row = (await svc.listEmployeeRows(ids.co, 2026, 11)).find((r) => r.username === "driver")!;
    expect(row.outstanding).toBe(25000);
  });

  it("preview does not store anything", async () => {
    const p = await svc.previewPayslip(ids.co, ids.emp, { year: 2026, month: 11, bonus: 2000 });
    expect(p).toMatchObject({ base: 50000, gross: 52000, advancesDeducted: 25000, net: 27000, paid: null });
    expect(await prisma.payslip.count()).toBe(0);
  });

  it("paying recovers advances FIFO, books only the net, and blocks a second payment", async () => {
    const slip = await svc.payPayslip(ids.co, ids.emp, { year: 2026, month: 11, bonus: 2000, deduction: 500, deductionNote: "late" });
    expect(Number(slip.net)).toBe(26500);
    expect(Number(slip.advancesDeducted)).toBe(25000);
    // 25000 of advances booked earlier + 26500 net now = gross 51500 − 0 over time
    expect(await sumExpenses(ids.co)).toBe(25000 + 26500);
    const adv = await prisma.employeeAdvance.findMany({ where: { employeeId: ids.emp }, orderBy: { date: "asc" } });
    expect(adv.map((a) => Number(a.remaining))).toEqual([0, 0]);
    await expect(svc.payPayslip(ids.co, ids.emp, { year: 2026, month: 11 })).rejects.toMatchObject({ code: "already_paid" });
    expect(await prisma.payslip.count()).toBe(1);
    const row = (await svc.listEmployeeRows(ids.co, 2026, 11)).find((r) => r.username === "driver")!;
    expect(row.paid?.net).toBe(26500);
    expect(row.outstanding).toBe(0);
    // another month is still payable
    expect((await svc.previewPayslip(ids.co, ids.emp, { year: 2026, month: 12 })).paid).toBeNull();
  });

  it("large advances carry over when the month can't absorb them", async () => {
    await svc.giveAdvance(ids.co, ids.emp, { amount: 80000 });
    const slip = await svc.payPayslip(ids.co, ids.emp, { year: 2026, month: 12 });
    expect(Number(slip.net)).toBe(0);
    expect(Number(slip.advancesDeducted)).toBe(50000);
    expect(slip.expenseId).toBeNull();
    const row = (await svc.listEmployeeRows(ids.co, 2027, 1)).find((r) => r.username === "driver")!;
    expect(row.outstanding).toBe(30000);
  });

  it("is company-isolated", async () => {
    await expect(svc.giveAdvance(ids.other, ids.emp, { amount: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.payPayslip(ids.other, ids.emp, { year: 2027, month: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.updateEmployee(ids.other, ids.emp, { salary: 1 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("deactivating blocks payroll and can be reversed", async () => {
    await svc.updateEmployee(ids.co, ids.emp, { isActive: false });
    await expect(svc.giveAdvance(ids.co, ids.emp, { amount: 1 })).rejects.toMatchObject({ code: "inactive" });
    const off = await prisma.employee.findUnique({ where: { id: ids.emp } });
    expect(off?.isActive).toBe(false);
    expect(off?.endDate).not.toBeNull();
    const again = await svc.enableEmployee(ids.co, { userId: ids.driver, salary: 60000 });
    expect(again.isActive).toBe(true);
    expect(again.endDate).toBeNull();
    expect(Number(again.salary)).toBe(60000);
  });
});
