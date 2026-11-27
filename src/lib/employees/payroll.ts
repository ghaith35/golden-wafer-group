/// Pure payroll maths (no DB) — shared by the preview API, the pay transaction
/// and the unit tests.

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money2 = r2;

export type NetInput = {
  base: number;
  bonus?: number;
  deduction?: number;
  /// Sum of `remaining` over the employee's open advances.
  outstandingAdvances: number;
};

export type NetResult = {
  gross: number;
  /// Advances recovered this month — capped so the net never goes below 0.
  advancesDeducted: number;
  /// Advance balance still to recover in later months.
  advancesCarried: number;
  net: number;
};

/// net = base + bonus − deduction − advances. Advances are capped at what the
/// month can absorb; the rest carries over instead of making a negative payslip.
export function computeNet({ base, bonus = 0, deduction = 0, outstandingAdvances }: NetInput): NetResult {
  const gross = Math.max(0, r2(base + bonus - deduction));
  const outstanding = Math.max(0, r2(outstandingAdvances));
  const advancesDeducted = r2(Math.min(outstanding, gross));
  return {
    gross,
    advancesDeducted,
    advancesCarried: r2(outstanding - advancesDeducted),
    net: r2(gross - advancesDeducted),
  };
}

export type OpenAdvance = { id: string; remaining: number };

/// Spread `amount` over the oldest advances first. Returns the new remaining
/// balance for each advance that was touched.
export function allocateFifo(advances: OpenAdvance[], amount: number): Array<{ id: string; remaining: number; used: number }> {
  let left = r2(amount);
  const out: Array<{ id: string; remaining: number; used: number }> = [];
  for (const a of advances) {
    if (left <= 0) break;
    const used = r2(Math.min(a.remaining, left));
    if (used <= 0) continue;
    out.push({ id: a.id, remaining: r2(a.remaining - used), used });
    left = r2(left - used);
  }
  return out;
}
