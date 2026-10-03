/// Shared debt-ledger helpers (Khiata-style statuses).

export type DebtStatus = "unpaid" | "partial" | "settled";

export function debtStatus(balance: number, paid: number): DebtStatus {
  if (balance <= 1e-9) return "settled";
  if (paid <= 1e-9) return "unpaid";
  return "partial";
}
