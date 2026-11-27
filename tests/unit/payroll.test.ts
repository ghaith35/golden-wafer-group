import { describe, expect, it } from "vitest";
import { allocateFifo, computeNet } from "@/lib/employees/payroll";

describe("computeNet", () => {
  it("plain salary", () => {
    expect(computeNet({ base: 50000, outstandingAdvances: 0 })).toEqual({ gross: 50000, advancesDeducted: 0, advancesCarried: 0, net: 50000 });
  });
  it("bonus and deduction", () => {
    const r = computeNet({ base: 50000, bonus: 5000, deduction: 2000, outstandingAdvances: 0 });
    expect(r.gross).toBe(53000);
    expect(r.net).toBe(53000);
  });
  it("recovers advances from the month", () => {
    const r = computeNet({ base: 50000, outstandingAdvances: 15000 });
    expect(r).toMatchObject({ advancesDeducted: 15000, advancesCarried: 0, net: 35000 });
  });
  it("caps advances at the gross and carries the rest over", () => {
    const r = computeNet({ base: 30000, outstandingAdvances: 45000 });
    expect(r).toMatchObject({ advancesDeducted: 30000, advancesCarried: 15000, net: 0 });
  });
  it("never goes negative when deductions exceed pay", () => {
    const r = computeNet({ base: 1000, deduction: 5000, outstandingAdvances: 200 });
    expect(r.gross).toBe(0);
    expect(r.net).toBe(0);
    expect(r.advancesCarried).toBe(200);
  });
  it("rounds to cents", () => {
    expect(computeNet({ base: 100.005, outstandingAdvances: 0.1 + 0.2 }).net).toBe(99.71);
  });
});

describe("allocateFifo", () => {
  const adv = [{ id: "a", remaining: 10000 }, { id: "b", remaining: 5000 }, { id: "c", remaining: 8000 }];
  it("drains the oldest first", () => {
    expect(allocateFifo(adv, 12000)).toEqual([
      { id: "a", remaining: 0, used: 10000 },
      { id: "b", remaining: 3000, used: 2000 },
    ]);
  });
  it("touches nothing for zero", () => {
    expect(allocateFifo(adv, 0)).toEqual([]);
  });
  it("stops when the advances run out", () => {
    const out = allocateFifo(adv, 99999);
    expect(out.map((x) => x.remaining)).toEqual([0, 0, 0]);
  });
});
