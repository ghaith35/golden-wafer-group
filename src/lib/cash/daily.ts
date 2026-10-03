import { prisma } from "@/lib/db";
import { ensureSeasonFor } from "@/lib/docs/sequences";

export type VanDayCash = {
  vanId: string;
  dayIso: string;
  expected: number;
  collected: number;
  dueTotal: number;
  clientPayments: number;
  expenses: number;
  returnsCash: number;
  /// Cash that should be handed over: collected + clientPayments − expenses − returnsCash.
  dueCash: number;
  declared: number | null;
  remitted: number;
  difference: number;
  salesCount: number;
  close: {
    id: string;
    status: "DECLARED" | "CLOSED";
    declaredById: string | null;
    declaredAt: unknown;
    closedById: string | null;
    closedAt: unknown;
    notes: string | null;
  } | null;
};

const dayRange = (day: Date) => {
  const s = new Date(day);
  s.setHours(0, 0, 0, 0);
  const e = new Date(s);
  e.setDate(e.getDate() + 1);
  return { s, e };
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function key(vanId: string, d: Date) {
  return `${vanId}|${iso(d)}`;
}

/// Live till math for one van-day (no DailyClose row needed).
export async function vanDayCash(
  companyId: string,
  vanId: string,
  day: Date
): Promise<{
  expected: number; collected: number; dueTotal: number;
  clientPayments: number; expenses: number; returnsCash: number;
  remittedLive: number; salesCount: number; closeRow: unknown;
}> {
  const { s, e } = dayRange(day);
  const [sales, versements, expenseRows, returnRows, closeRow] = await Promise.all([
    prisma.sale.findMany({
      where: {
        companyId,
        locationId: vanId,
        kind: { in: ["DELIVERY", "TICKET"] },
        status: { notIn: ["CANCELLED", "DRAFT"] },
        date: { gte: s, lt: e },
      },
      select: { total: true, paid: true },
    }),
    prisma.versement.findMany({
      where: { companyId, locationId: vanId, date: { gte: s, lt: e } },
      select: { kind: true, amount: true, transferId: true },
    }),
    prisma.expense.findMany({
      where: { companyId, locationId: vanId, expenseDate: { gte: s, lt: e }, deletedAt: null },
      select: { amount: true },
    }),
    prisma.clientReturn.findMany({
      where: { companyId, locationId: vanId, refundType: "CASH", date: { gte: s, lt: e } },
      select: { total: true },
    }),
    prisma.dailyClose.findFirst({ where: { companyId, vanId, date: s } }),
  ]);
  // Handovers booked the old way (transfer cashAmount, no locationId yet):
  // attribute via the transfer destination.
  const legacyIds = versements.filter((v) => v.transferId).map((v) => v.transferId as string);
  const legacyTransfers = legacyIds.length
    ? await prisma.transfer.findMany({
        where: { id: { in: legacyIds }, companyId, toLocationId: vanId },
        select: { id: true },
      })
    : [];
  const legacySet = new Set(legacyTransfers.map((t) => t.id));

  const expected = sales.reduce((x, r) => x + Number(r.total), 0);
  const collected = sales.reduce((x, r) => x + Number(r.paid), 0);
  const clientPayments = versements
    .filter((v) => v.kind === "CLIENT_PAYMENT")
    .reduce((x, v) => x + Number(v.amount), 0);
  const remittedLive = versements
    .filter((v) => v.kind === "CASH_COLLECTION" && (v.transferId == null || legacySet.has(v.transferId)))
    .reduce((x, v) => x + Number(v.amount), 0);
  const expenses = expenseRows.reduce((x, r) => x + Number(r.amount), 0);
  const returnsCash = returnRows.reduce((x, r) => x + Number(r.total), 0);
  return {
    expected,
    collected,
    dueTotal: Math.max(0, expected - collected),
    clientPayments,
    expenses,
    returnsCash,
    remittedLive,
    salesCount: sales.length,
    closeRow,
  };
}

/// Month grid for the page: one row per van-day with activity or a close.
export async function cashMonth(
  companyId: string,
  year: number,
  month: number
): Promise<{ vans: Array<{ id: string; name: string; matricule: string | null; driver: string | null }>; rows: VanDayCash[] }> {
  const vans = await prisma.store.findMany({
    where: { companyId, kind: "VAN", isActive: true },
    select: { id: true, name: true, matricule: true, user: { select: { fullName: true } } },
    orderBy: { name: "asc" },
  });
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const days: Date[] = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) days.push(new Date(d));

  const rows: VanDayCash[] = [];
  for (const v of vans) {
    // Tournee days (presence) so empty days still show their status.
    const tournees = await prisma.tournee.findMany({
      where: { companyId, locationId: v.id, date: { gte: start, lt: end } },
      select: { date: true, startedAt: true, finishedAt: true },
    });
    const tourByIso = new Map(tournees.map((t) => [iso(new Date(t.date)), t]));
    for (const d of days) {
      const live = await vanDayCash(companyId, v.id, d);
      const hasActivity =
        live.salesCount > 0 || live.clientPayments > 0 || live.expenses > 0 ||
        live.returnsCash > 0 || live.remittedLive > 0;
      const tour = tourByIso.get(iso(d));
      if (!hasActivity && !live.closeRow && !tour) continue;
      const c = live.closeRow as {
        id: string; status: "DECLARED" | "CLOSED"; declared: unknown;
        declaredById: string | null; declaredAt: unknown;
        closedById: string | null; closedAt: unknown; notes: string | null;
        remitted: unknown; difference: unknown;
      } | null;
      const closed = c?.status === "CLOSED";
      rows.push({
        vanId: v.id,
        dayIso: iso(d),
        expected: closed ? Number((c as unknown as { expected: unknown }).expected) : live.expected,
        collected: closed ? Number((c as unknown as { collected: unknown }).collected) : live.collected,
        dueTotal: closed ? Number((c as unknown as { dueTotal: unknown }).dueTotal) : live.dueTotal,
        clientPayments: closed ? Number((c as unknown as { clientPayments: unknown }).clientPayments) : live.clientPayments,
        expenses: closed ? Number((c as unknown as { expenses: unknown }).expenses) : live.expenses,
        returnsCash: closed ? Number((c as unknown as { returnsCash: unknown }).returnsCash) : live.returnsCash,
        dueCash: 0,
        declared: c?.declared != null ? Number(c.declared) : null,
        remitted: closed ? Number(c?.remitted ?? 0) : Number(c?.remitted ?? 0) + 0,
        difference: 0,
        salesCount: live.salesCount,
        close: c ? {
          id: c.id, status: c.status, declaredById: c.declaredById,
          declaredAt: c.declaredAt, closedById: c.closedById,
          closedAt: c.closedAt, notes: c.notes,
        } : null,
      });
      const r = rows[rows.length - 1];
      // Remitted is always live (every handover is a versement) except once
      // closed, where the snapshot rules. No stored accumulation = no double count.
      r.remitted = closed ? Number(c?.remitted ?? 0) : live.remittedLive;
      r.dueCash = r.collected + r.clientPayments - r.expenses - r.returnsCash;
      r.difference = r.remitted - r.dueCash;
    }
  }
  return {
    vans: vans.map((v) => ({ id: v.id, name: v.name, matricule: v.matricule, driver: v.user?.fullName ?? null })),
    rows,
  };
}

async function assertVanAccess(companyId: string, userId: string, role: string, vanId: string) {
  if (role === "Admin") return;
  const van = await prisma.store.findFirst({ where: { id: vanId, companyId, kind: "VAN" }, select: { userId: true } });
  if (!van || van.userId !== userId) throw Object.assign(new Error("forbidden"), { status: 403 });
}

function parseDay(dateIso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) throw Object.assign(new Error("bad_date"), { status: 400 });
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

/// Livreur counted his till → DECLARED (or updates the declaration).
export async function declareCash(
  companyId: string,
  userId: string,
  role: string,
  vanId: string,
  dateIso: string,
  amount: number,
  notes?: string | null
) {
  await assertVanAccess(companyId, userId, role, vanId);
  if (!(amount >= 0) || !Number.isFinite(amount)) throw Object.assign(new Error("bad_amount"), { status: 400 });
  const day = parseDay(dateIso);
  const live = await vanDayCash(companyId, vanId, day);
  if ((live.closeRow as { status: string } | null)?.status === "CLOSED") {
    throw Object.assign(new Error("already_closed"), { status: 400 });
  }
  const season = await ensureSeasonFor(companyId, day);
  return prisma.dailyClose.upsert({
    where: { companyId_vanId_date: { companyId, vanId, date: day } },
    create: {
      companyId, seasonId: season.id, vanId, date: day,
      expected: live.expected, collected: live.collected,
      clientPayments: live.clientPayments, expenses: live.expenses,
      returnsCash: live.returnsCash, dueTotal: live.dueTotal,
      declared: amount, declaredById: userId, declaredAt: new Date(),
      remitted: 0, difference: 0 - (live.collected + live.clientPayments - live.expenses - live.returnsCash),
      status: "DECLARED", notes: notes ?? null,
    },
    update: {
      declared: amount, declaredById: userId, declaredAt: new Date(),
      ...(notes !== undefined ? { notes: notes ?? null } : {}),
    },
  });
}

/// Admin accepts a handover → CASH_COLLECTION versement + remitted bump.
export async function remitCash(
  companyId: string,
  userId: string,
  vanId: string,
  dateIso: string,
  amount: number,
  notes?: string | null
) {
  if (!(amount > 0) || !Number.isFinite(amount)) throw Object.assign(new Error("bad_amount"), { status: 400 });
  const day = parseDay(dateIso);
  const live = await vanDayCash(companyId, vanId, day);
  if ((live.closeRow as { status: string } | null)?.status === "CLOSED") {
    throw Object.assign(new Error("already_closed"), { status: 400 });
  }
  const season = await ensureSeasonFor(companyId, day);
  const dueCash = live.collected + live.clientPayments - live.expenses - live.returnsCash;
  const v = await prisma.versement.create({
    data: {
      companyId, seasonId: season.id, kind: "CASH_COLLECTION",
      locationId: vanId, amount, date: day, notes: notes ?? null,
    },
  });
  // Ensure a row exists so the declaration/close flow has something to lock.
  await prisma.dailyClose.upsert({
    where: { companyId_vanId_date: { companyId, vanId, date: day } },
    create: {
      companyId, seasonId: season.id, vanId, date: day,
      expected: live.expected, collected: live.collected,
      clientPayments: live.clientPayments, expenses: live.expenses,
      returnsCash: live.returnsCash, dueTotal: live.dueTotal,
      remitted: 0, difference: 0 - dueCash,
      status: "DECLARED", notes: notes ?? null,
    },
    update: {},
  });
  void userId;
  const remitted = live.remittedLive + amount;
  return { id: v.id, remitted, difference: remitted - dueCash };
}

/// Admin locks the day: recompute + snapshot. Reopen returns to DECLARED.
export async function closeDay(
  companyId: string,
  userId: string,
  vanId: string,
  dateIso: string,
  notes?: string | null
) {
  const day = parseDay(dateIso);
  const live = await vanDayCash(companyId, vanId, day);
  if ((live.closeRow as { status: string } | null)?.status === "CLOSED") {
    throw Object.assign(new Error("already_closed"), { status: 400 });
  }
  const season = await ensureSeasonFor(companyId, day);
  const dueCash = live.collected + live.clientPayments - live.expenses - live.returnsCash;
  const prev = live.closeRow as { declared: unknown } | null;
  // Snapshot the live numbers — including live handovers.
  const remitted = live.remittedLive;
  return prisma.dailyClose.upsert({
    where: { companyId_vanId_date: { companyId, vanId, date: day } },
    create: {
      companyId, seasonId: season.id, vanId, date: day,
      expected: live.expected, collected: live.collected,
      clientPayments: live.clientPayments, expenses: live.expenses,
      returnsCash: live.returnsCash, dueTotal: live.dueTotal,
      declared: prev?.declared != null ? Number(prev.declared) : null,
      remitted, difference: remitted - dueCash,
      status: "CLOSED", closedById: userId, closedAt: new Date(),
      notes: notes ?? null,
    },
    update: {
      expected: live.expected, collected: live.collected,
      clientPayments: live.clientPayments, expenses: live.expenses,
      returnsCash: live.returnsCash, dueTotal: live.dueTotal,
      remitted, difference: remitted - dueCash,
      status: "CLOSED", closedById: userId, closedAt: new Date(),
      ...(notes !== undefined ? { notes: notes ?? null } : {}),
    },
  });
}

export async function reopenDay(companyId: string, vanId: string, dateIso: string) {
  const day = parseDay(dateIso);
  const row = await prisma.dailyClose.findFirst({ where: { companyId, vanId, date: day } });
  if (!row) throw Object.assign(new Error("not_found"), { status: 404 });
  if (row.status !== "CLOSED") throw Object.assign(new Error("bad_status"), { status: 400 });
  return prisma.dailyClose.update({
    where: { id: row.id },
    data: { status: "DECLARED", closedById: null, closedAt: null },
  });
}
