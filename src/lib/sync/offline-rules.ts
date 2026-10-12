"use client";

/// Offline correctness helpers for the van phone.
///
/// Two jobs:
///  1. Mirror the server's business rules using the synced snapshot, so the
///     phone blocks an action the server would reject BEFORE goods change hands
///     (no more "saved offline then permanently failed on sync").
///  2. Compute "effective" stock / balance = snapshot − pending outbox ops, so
///     a van that already sold offline doesn't promise the same units twice.

import type { OutboxRow } from "./offline-db";
import type { VanSnapshot } from "./client";

const EPS = 1e-9;

export const KIND_PRIORITY: Record<string, number> = {
  client: 0,
  "client-update": 1,
  "day-start": 1,
  ticket: 2,
  order: 2,
  "client-return": 2,
  "transfer-declare": 3,
  "transfer-confirm": 4,
  versement: 5,
  "cash-declare": 6,
  "stop-update": 7,
  "day-finish": 8,
};

/// Dependency order (client before its ticket, declare before confirm).
export function sortOutbox(ops: OutboxRow[]): OutboxRow[] {
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => (KIND_PRIORITY[a.op.kind] ?? 99) - (KIND_PRIORITY[b.op.kind] ?? 99) || a.i - b.i)
    .map((x) => x.op);
}

type Priced = { productId: string; unitId?: string | null; qty: number; unitPrice?: number | null; remise?: number };

function factorOf(snap: VanSnapshot | null, productId: string, unitId: string | null | undefined): number {
  if (!unitId) return 1;
  const p = snap?.products.find((x) => x.id === productId);
  if (!p) return 1;
  if (p.baseUnit?.id === unitId) return 1;
  const c = p.conversions.find((x) => x.unitId === unitId);
  if (!c) return 1;
  const f = Number(c.factor);
  return f < 1 ? 1 / Math.round(1 / f) : f;
}

/// qty in base units for a line (uses the snapshot's conversion table).
export function baseQtyOf(snap: VanSnapshot | null, productId: string, unitId: string | null | undefined, qty: number): number {
  return Number(qty) * factorOf(snap, productId, unitId);
}

function lineTotal(l: Priced): number {
  return Math.max(0, Number(l.qty) * Number(l.unitPrice ?? 0) - Number(l.remise ?? 0));
}

export type PendingEffects = {
  /// Van stock delta per product (negative = sold).
  stock: Record<string, number>;
  /// Client balance delta (positive = owes more).
  balance: Record<string, number>;
};

/// Effects of all queued (not yet synced) ops.
export function pendingEffects(snap: VanSnapshot | null, ops: OutboxRow[], vanId?: string | null): PendingEffects {
  const stock: Record<string, number> = {};
  const balance: Record<string, number> = {};
  const addStock = (pid: string, d: number) => { stock[pid] = (stock[pid] ?? 0) + d; };
  const addBal = (cid: string | null | undefined, d: number) => { if (cid) balance[cid] = (balance[cid] ?? 0) + d; };

  for (const op of ops) {
    const p = op.payload as Record<string, unknown>;
    if (op.kind === "ticket" || op.kind === "order") {
      const lines = Array.isArray(p.lines) ? (p.lines as Priced[]) : [];
      let total = 0;
      for (const l of lines) {
        total += lineTotal(l);
        // A ticket moves stock immediately; a DRAFT order does not.
        if (op.kind === "ticket") addStock(l.productId, -baseQtyOf(snap, l.productId, l.unitId, Number(l.qty)));
      }
      total = Math.max(0, total - Number(p.remise ?? 0));
      if (op.kind === "ticket") {
        const paid = p.paid == null ? total : Number(p.paid);
        const due = total - paid;
        if (due > EPS) addBal(p.clientId as string | null, due);
      }
    } else if (op.kind === "versement") {
      addBal(p.clientId as string | null, -Number(p.amount ?? 0));
    } else if (op.kind === "client-return") {
      const lines = Array.isArray(p.lines) ? (p.lines as Array<{ productId: string; baseQty: number; unitPrice: number }>) : [];
      let total = 0;
      for (const l of lines) {
        addStock(l.productId, Number(l.baseQty ?? 0));
        total += Number(l.baseQty ?? 0) * Number(l.unitPrice ?? 0);
      }
      if (p.refundType === "DEBT_CREDIT") addBal(p.clientId as string | null, -total);
    } else if (op.kind === "transfer-declare") {
      // Van→depot return reduces sellable stock immediately; depot→van is
      // holding until confirm (covered by holds after sync).
      if (vanId && p.fromLocationId === vanId) {
        const lines = Array.isArray(p.lines) ? (p.lines as Array<{ productId: string; qty: number }>) : [];
        for (const l of lines) addStock(l.productId, -Number(l.qty ?? 0));
      }
    }
  }
  return { stock, balance };
}

/// Effective van stock per product = snapshot stock − pending ticket sales.
export function effectiveStock(snap: VanSnapshot | null, ops: OutboxRow[], vanId?: string | null): Record<string, number> {
  const eff: Record<string, number> = {};
  for (const b of snap?.stock ?? []) eff[b.productId] = Number(b.qty);
  const { stock } = pendingEffects(snap, ops, vanId);
  for (const [pid, d] of Object.entries(stock)) eff[pid] = (eff[pid] ?? 0) + d;
  return eff;
}

/// Effective client balance = snapshot balance + pending credit sales − payments.
export function effectiveBalance(snap: VanSnapshot | null, ops: OutboxRow[], clientId: string | null | undefined): number {
  const base = clientId ? Number(snap?.clients.find((c) => c.id === clientId)?.balance ?? 0) : 0;
  if (!clientId) return base;
  const { balance } = pendingEffects(snap, ops, null);
  return base + (balance[clientId] ?? 0);
}

export type SaleCheck =
  | { ok: true; total: number; due: number }
  | { ok: false; error: string };

/// Mirror the server's ticket/order guards using the snapshot.
/// Returns `ok:false` with the SAME error code the server would return.
export function checkOfflineSale(args: {
  snap: VanSnapshot | null;
  ops: OutboxRow[];
  channel: string;
  clientId: string | null;
  lines: Priced[];
  remise?: number;
  paid?: number | null;
  qrScanned?: boolean;
  vanId?: string | null;
}): SaleCheck {
  const { snap, ops, channel, clientId, lines, remise = 0, paid, qrScanned, vanId } = args;
  const settings = snap?.settings;

  // All lines must be priced locally to reason about money/credit.
  const priced = lines.every((l) => l.unitPrice != null && Number.isFinite(Number(l.unitPrice)));
  const linesTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(0, linesTotal - remise);

  if (settings) {
    if (remise > 0 && !settings.remiseEnabled) return { ok: false, error: "remise_disabled" };

    // QR rule (van sales only) — strict mode cannot be bypassed offline.
    if (channel === "VAN" && clientId && settings.qrStrictMode && !qrScanned) {
      return { ok: false, error: "qr_required" };
    }

    // Stock cap when oversell is not allowed.
    if (!settings.oversellAllowed) {
      const eff = effectiveStock(snap, ops, vanId);
      for (const l of lines) {
        const need = baseQtyOf(snap, l.productId, l.unitId, Number(l.qty));
        if ((eff[l.productId] ?? 0) + EPS < need) return { ok: false, error: "insufficient_stock" };
      }
    }

    // Credit guard (only when the sale leaves a debt).
    if (priced) {
      const paidNow = paid == null ? total : Number(paid);
      const due = total - paidNow;
      if (due > EPS) {
        if (!settings.creditSalesEnabled) return { ok: false, error: "cash_only" };
        if (!settings.debtTrackingEnabled) return { ok: false, error: "debt_disabled" };
        if (!clientId) return { ok: false, error: "client_required" };
        const limit = Number(snap?.clients.find((c) => c.id === clientId)?.creditLimit ?? 0);
        const bal = effectiveBalance(snap, ops, clientId);
        if (limit > 0 && bal + due > limit + EPS) return { ok: false, error: "credit_limit_exceeded" };
      }
      if (paidNow - total > 0.005) return { ok: false, error: "overpaid" };
    }
  }

  return { ok: true, total, due: total - (paid == null ? total : Number(paid)) };
}

/// Mirror the client-create validation (phone format + duplicate phone).
export function checkOfflineClient(
  snap: VanSnapshot | null,
  ops: OutboxRow[],
  input: { phone?: string | null },
): { ok: true } | { ok: false; error: string } {
  return checkClientPhone(snap, ops, null, input.phone);
}

/// Same, for EDITING an existing client: duplicates exclude the client
/// itself (snapshot + queued creates + queued updates of OTHER clients).
export function checkOfflineClientUpdate(
  snap: VanSnapshot | null,
  ops: OutboxRow[],
  selfId: string,
  input: { phone?: string | null },
): { ok: true } | { ok: false; error: string } {
  return checkClientPhone(snap, ops, selfId, input.phone);
}

function checkClientPhone(
  snap: VanSnapshot | null,
  ops: OutboxRow[],
  selfId: string | null,
  phone?: string | null,
): { ok: true } | { ok: false; error: string } {
  const p = (phone ?? "").trim();
  if (p && !/^(0)(5|6|7)[0-9]{8}$/.test(p)) return { ok: false, error: "bad_phone" };
  if (p) {
    const dupSnap = snap?.clients.some((c) => c.id !== selfId && (c.phone ?? "") === p);
    const dupQueue = ops.some((o) => {
      const q = o.payload as Record<string, unknown>;
      if (o.kind === "client") return String(q.phone ?? "") === p;
      if (o.kind === "client-update") {
        const qid = typeof q.clientId === "string" ? q.clientId : null;
        if (qid === selfId || (selfId?.startsWith("pending:") && qid === selfId)) return false;
        return String((q.patch as Record<string, unknown> | undefined)?.phone ?? "") === p;
      }
      return false;
    });
    if (dupSnap || dupQueue) return { ok: false, error: "duplicate_phone" };
  }
  return { ok: true };
}
